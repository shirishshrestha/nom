import { Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import pLimit from 'p-limit';
import type {
  BatchOptions,
  ExtractionRequest,
  ExtractorConfig,
  HumanPart,
  MediaPart,
  StructuredExtractor,
  TextPart,
} from './structured-extractor.port';
import { DocumentTooLargeError } from './llm-error';

// Map our provider-agnostic parts onto LangChain message content blocks.
function toContentPart(part: HumanPart) {
  return part.type === 'media'
    ? { type: 'media', mimeType: part.mimeType, data: part.dataBase64 }
    : { type: 'text', text: part.text };
}

// ponytail: a flat char-count proxy (~4 chars/token), not a real tokenizer — good
// enough to flag an oversized call. Move to per-binding ExtractorConfig if Gemini vs
// Anthropic context windows ever need distinct thresholds.
const SOFT_CONTEXT_CHARS = 400_000;

// Text length only — media (base64) is reported separately since its char count
// doesn't map to tokens the same way and shouldn't count toward the text budget.
function estimateChars(system: string, human: string | HumanPart[]): number {
  const humanChars =
    typeof human === 'string'
      ? human.length
      : human
          .filter((p): p is TextPart => p.type === 'text')
          .reduce((sum, p) => sum + p.text.length, 0);
  return system.length + humanChars;
}

function mediaByteCount(human: string | HumanPart[]): number {
  if (typeof human === 'string') return 0;
  return human
    .filter((p): p is MediaPart => p.type === 'media')
    .reduce((sum, p) => sum + p.dataBase64.length, 0);
}

/**
 * LangChain-backed StructuredExtractor — the ONLY place in the documents/source
 * paths that imports `@langchain/*`. Provider-agnostic: it works with any
 * `BaseChatModel`, so the InfraModule binds it twice (Gemini for extraction,
 * Anthropic/Haiku for adjudication) via factory providers. Retry is provider-native.
 */
export class LangchainStructuredExtractor implements StructuredExtractor {
  private readonly logger = new Logger(LangchainStructuredExtractor.name);
  // ponytail: Gemini omits `model` from response_metadata (Anthropic includes it), so fall
  // back to the configured model on the bound instance — both concrete classes expose `.model`.
  private readonly configuredModel: string | null;

  constructor(
    private readonly model: BaseChatModel,
    private readonly cfg: ExtractorConfig,
  ) {
    this.configuredModel = (model as { model?: string }).model ?? null;
  }

  async extract<O>(req: ExtractionRequest<O>): Promise<O> {
    const attempts = req.options?.maxAttempts ?? this.cfg.defaultMaxAttempts;
    // includeRaw so we can inspect finishReason: a MAX_TOKENS truncation otherwise
    // surfaces as an opaque JSON-parse error that provider retry just repeats.
    const base = this.model.withStructuredOutput<O & Record<string, unknown>>(
      req.schema,
      { includeRaw: true },
    );
    const runnable =
      attempts > 1 ? base.withRetry({ stopAfterAttempt: attempts }) : base;

    const human =
      typeof req.human === 'string'
        ? new HumanMessage(req.human)
        : new HumanMessage({ content: req.human.map(toContentPart) });

    // Log the call boundary by operation tag + duration only — never prompt/output.
    const op = req.options?.operation ?? 'extract';
    const start = Date.now();
    const chars = estimateChars(req.system, req.human);
    if (chars > SOFT_CONTEXT_CHARS) {
      const mediaBytes = mediaByteCount(req.human);
      this.logger.warn(
        `llm ${op} oversized ~${chars} chars (soft target ${SOFT_CONTEXT_CHARS})` +
          (mediaBytes > 0 ? ` + ${mediaBytes} base64 media chars` : ''),
      );
    }
    try {
      const { raw, parsed } = (await runnable.invoke([
        new SystemMessage(req.system),
        human,
      ])) as {
        raw: {
          response_metadata?: Record<string, unknown>;
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
        };
        parsed: O;
      };
      const finish =
        raw?.response_metadata?.finishReason ??
        raw?.response_metadata?.finish_reason;
      if (finish === 'MAX_TOKENS') {
        throw new DocumentTooLargeError(
          `llm ${op} truncated at the output limit (finishReason MAX_TOKENS) — document too large for a single extraction`,
        );
      }
      req.options?.onUsage?.({
        inputTokens: raw?.usage_metadata?.input_tokens ?? null,
        outputTokens: raw?.usage_metadata?.output_tokens ?? null,
        model:
          (raw?.response_metadata?.model as string | undefined) ??
          this.configuredModel,
      });
      this.logger.debug(`llm ${op} ok +${Date.now() - start}ms`);
      return parsed;
    } catch (e) {
      this.logger.warn(
        `llm ${op} failed +${Date.now() - start}ms: ${(e as Error).message}`,
      );
      throw e;
    }
  }

  async extractMany<I, O>(
    items: readonly I[],
    build: (item: I, index: number) => ExtractionRequest<O>,
    options?: BatchOptions,
  ): Promise<O[]> {
    const limit = pLimit(options?.concurrency ?? this.cfg.defaultConcurrency);
    return Promise.all(
      items.map((item, index) =>
        limit(() =>
          this.extract({
            ...build(item, index),
            options: {
              maxAttempts: options?.maxAttempts,
              operation: options?.operation,
            },
          }),
        ),
      ),
    );
  }
}
