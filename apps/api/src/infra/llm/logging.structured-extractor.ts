import { Logger } from '@nestjs/common';
import pLimit from 'p-limit';
import type { LlmCallLogRepository } from './llm-call-log.repository';
import type {
  BatchOptions,
  ExtractionRequest,
  HumanPart,
  StructuredExtractor,
} from './structured-extractor.port';

// Media bytes live in S3 already — persist only their shape, never the base64.
function redactHuman(human: string | HumanPart[]): unknown {
  if (typeof human === 'string') return human;
  return human.map((p) =>
    p.type === 'media'
      ? { type: 'media', mimeType: p.mimeType, byteLength: p.dataBase64.length }
      : p,
  );
}

/**
 * StructuredExtractor decorator that persists every call (input + output) for
 * fine-tuning data prep. Wraps any inner extractor; delegates the actual call and
 * then records a row. Logging never changes call-site behavior: on model failure it
 * records succeeded=false and rethrows; a failed audit write is warn-logged and
 * swallowed. A call with no `reference` skips the write (can't satisfy tenancy).
 */
export class LoggingStructuredExtractor implements StructuredExtractor {
  private readonly logger = new Logger(LoggingStructuredExtractor.name);

  constructor(
    private readonly inner: StructuredExtractor,
    private readonly log: LlmCallLogRepository,
    private readonly provider: string,
    // Bounded default so an un-parameterized fan-out honors the port contract
    // ("defaults to the configured concurrency") instead of running unbounded.
    private readonly defaultConcurrency: number,
  ) {}

  async extract<O>(req: ExtractionRequest<O>): Promise<O> {
    const occurredAt = new Date();
    const start = Date.now();
    // Captured by the inner extractor's onUsage sink; null on providers/responses
    // that omit usage_metadata, or when the call fails before a response.
    let usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      model: string | null;
    } | null = null;
    const withSink: ExtractionRequest<O> = {
      ...req,
      options: { ...req.options, onUsage: (u) => (usage = u) },
    };
    try {
      const output = await this.inner.extract(withSink);
      await this.write(
        req,
        output,
        true,
        null,
        occurredAt,
        Date.now() - start,
        usage,
      );
      return output;
    } catch (e) {
      await this.write(
        req,
        null,
        false,
        (e as Error).message,
        occurredAt,
        Date.now() - start,
        usage,
      );
      throw e;
    }
  }

  // Reimplements the bounded fan-out (rather than delegating to inner.extractMany)
  // so each item routes through this.extract and is individually logged. Preserves
  // each item's `reference` from build() while applying batch-level operation/retry.
  extractMany<I, O>(
    items: readonly I[],
    build: (item: I, index: number) => ExtractionRequest<O>,
    options?: BatchOptions,
  ): Promise<O[]> {
    const limit = pLimit(options?.concurrency ?? this.defaultConcurrency);
    return Promise.all(
      items.map((item, index) =>
        limit(() => {
          const built = build(item, index);
          return this.extract({
            ...built,
            options: {
              ...built.options,
              maxAttempts: options?.maxAttempts ?? built.options?.maxAttempts,
              operation: options?.operation ?? built.options?.operation,
            },
          });
        }),
      ),
    );
  }

  private async write(
    req: ExtractionRequest<unknown>,
    output: unknown,
    succeeded: boolean,
    errorMessage: string | null,
    occurredAt: Date,
    durationMs: number,
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      model: string | null;
    } | null,
  ): Promise<void> {
    const ref = req.options?.reference;
    if (!ref) {
      this.logger.warn(
        `llm call for ${req.options?.operation ?? 'extract'} has no reference — skipping log write`,
      );
      return;
    }
    const [promptId, promptVersion = ''] = (
      req.options?.operation ?? 'extract'
    ).split('@');
    try {
      await this.log.record({
        organizationId: ref.organizationId,
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        promptId,
        promptVersion,
        provider: this.provider,
        systemPrompt: req.system,
        humanPrompt: redactHuman(req.human),
        output,
        succeeded,
        errorMessage,
        durationMs,
        occurredAt,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        model: usage?.model ?? null,
      });
    } catch (e) {
      this.logger.warn(`llm_call_logs write failed: ${(e as Error).message}`);
    }
  }
}
