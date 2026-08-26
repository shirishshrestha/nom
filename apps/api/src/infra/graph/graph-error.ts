// Typed graph failures so callers can distinguish a graph problem from any other
// error and decide per-call whether it is fatal (service commit) or a logged
// warning (document mirror).

export class GraphWriteError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GraphWriteError';
  }
}

export class GraphReadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GraphReadError';
  }
}
