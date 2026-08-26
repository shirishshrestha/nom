// Raised when a document is too large to extract in a single call — either the
// input exceeds the pre-flight byte guard, or the model truncated its output
// (finishReason MAX_TOKENS). Callers isolate it per-file rather than failing a batch.
export class DocumentTooLargeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DocumentTooLargeError';
  }
}
