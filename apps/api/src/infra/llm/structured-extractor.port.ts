import type { ZodType } from 'zod';

/**
 * Provider-agnostic port for structured (schema-validated) LLM extraction.
 *
 * Business code depends on this interface — never on LangChain's `BaseChatModel`,
 * `withStructuredOutput`, or the `HumanMessage`/`SystemMessage` classes. The
 * concrete provider (Gemini today) owns all of that. Tests substitute
 * `FakeStructuredExtractor`.
 */

export interface TextPart {
  type: 'text';
  text: string;
}

export interface MediaPart {
  type: 'media';
  mimeType: string;
  /** Base64-encoded bytes. */
  dataBase64: string;
}

export type HumanPart = TextPart | MediaPart;

export interface ExtractCallOptions {
  /** Total attempts including the first try; maps to the provider's native retry. */
  maxAttempts?: number;
  /** Free-form tag for logging/metrics (e.g. 'document.extract', 'vendor.match'). */
  operation?: string;
  /**
   * Tenant + generic entity pointer this call was performed for. When present, the
   * logging decorator persists a row; when absent it skips the write (see
   * LoggingStructuredExtractor). Threaded from the *Flow layer down.
   */
  reference?: { organizationId: string; sourceType: string; sourceId: string };
  /**
   * Out-sink for the provider's token usage + resolved model, fired once per call by
   * the concrete extractor. The logging decorator injects this to capture usage for
   * llm_call_logs; business callers never set it. Values are null when the response
   * omits usage_metadata.
   */
  onUsage?: (u: {
    inputTokens: number | null;
    outputTokens: number | null;
    model: string | null;
  }) => void;
}

export interface ExtractionRequest<O> {
  /** Resolved system prompt text. */
  system: string;
  /** Human turn — a plain string or multimodal parts. */
  human: string | HumanPart[];
  /** Output contract; the provider validates against it. */
  schema: ZodType<O>;
  options?: ExtractCallOptions;
}

export interface BatchOptions {
  /** Max in-flight calls. Defaults to the configured concurrency. */
  concurrency?: number;
  maxAttempts?: number;
  operation?: string;
}

export interface StructuredExtractor {
  /** Single structured-output call with provider-native retry. */
  extract<O>(req: ExtractionRequest<O>): Promise<O>;

  /**
   * Fan-out with BOUNDED concurrency. Order-preserving. Replaces every
   * `Promise.all(items.map(...))` over independent LLM calls.
   */
  extractMany<I, O>(
    items: readonly I[],
    build: (item: I, index: number) => ExtractionRequest<O>,
    options?: BatchOptions,
  ): Promise<O[]>;
}

export interface ExtractorConfig {
  /** Default max in-flight LLM calls for extractMany. */
  defaultConcurrency: number;
  /** Default total attempts per call. */
  defaultMaxAttempts: number;
}
