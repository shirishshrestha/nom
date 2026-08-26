import type {
  ExtractionRequest,
  StructuredExtractor,
} from './structured-extractor.port';

/**
 * Test double for {@link StructuredExtractor}. Construct with a responder that
 * maps each request to its (already schema-shaped) output; inspect `calls` to
 * assert what the collaborator asked the LLM for. No LangChain, no mocking of
 * `withStructuredOutput`.
 */
export class FakeStructuredExtractor implements StructuredExtractor {
  readonly calls: ExtractionRequest<unknown>[] = [];

  constructor(
    private readonly responder: (req: ExtractionRequest<unknown>) => unknown,
  ) {}

  extract<O>(req: ExtractionRequest<O>): Promise<O> {
    this.calls.push(req);
    return Promise.resolve(this.responder(req) as O);
  }

  async extractMany<I, O>(
    items: readonly I[],
    build: (item: I, index: number) => ExtractionRequest<O>,
  ): Promise<O[]> {
    return Promise.all(items.map((item, i) => this.extract<O>(build(item, i))));
  }
}
