# LLM infrastructure: the structured-extraction substrate

Every LLM call in the pipeline goes through one port — `StructuredExtractor` — so business code
never touches LangChain, model SDKs, or provider quirks. This doc covers the port, the two
decorators wrapping it, the two model bindings, and how prompts are versioned and logged.

> **One seam for all inference.** Extraction, adjudication, and resolution all call
> `extractor.extract({ system, human, schema })` and get back a schema-validated object. The
> concrete provider, retry, token accounting, and audit logging live behind the port.

---

## The port

`StructuredExtractor` ([structured-extractor.port.ts](../structured-extractor.port.ts)):

- `extract<O>(req)` — one structured-output call with provider-native retry, returns a validated `O`.
- `extractMany(items, build, opts)` — bounded-concurrency fan-out (order-preserving), for the
  per-chunk extraction loops.

A request carries `system`, `human` (string or multimodal parts), a zod `schema`, and options
(`operation` tag, tenancy `reference`, `onUsage` sink). Tests substitute
[fake.structured-extractor.ts](../fake.structured-extractor.ts).

## Two decorators, layered

```
LoggingStructuredExtractor  ─wraps─▶  LangchainStructuredExtractor  ─▶  BaseChatModel (Gemini | Haiku)
   (persist llm_call_logs)              (withStructuredOutput + retry)
```

- **`LangchainStructuredExtractor`** ([langchain.structured-extractor.ts](../langchain.structured-extractor.ts))
  is the only place importing `@langchain/*`. It calls `model.withStructuredOutput(schema, { includeRaw: true })`
  so it can inspect `finishReason` (a `MAX_TOKENS` truncation is turned into a typed
  `DocumentTooLargeError` instead of an opaque JSON-parse failure), and fires `onUsage` with
  input/output tokens and the resolved model name.
- **`LoggingStructuredExtractor`** ([logging.structured-extractor.ts](../logging.structured-extractor.ts))
  wraps any inner extractor and persists one `llm_call_logs` row per call — success or failure —
  for fine-tuning data prep and auditing. A call with no tenancy `reference` skips the write; a
  failed audit write is warn-logged and swallowed (logging never changes call behaviour).

## `llm_call_logs` — the audit surface

Each row ([llm-call-log.repository.ts](../llm-call-log.repository.ts)) captures: `organizationId`,
`sourceType`/`sourceId`, `promptId` + `promptVersion`, `provider`, the **`systemPrompt`**, the
redacted **`humanPrompt`** (media bytes replaced by their shape — never base64), the model
**`output`**, `succeeded`/`errorMessage`, `durationMs`, token counts, and `model`.

This is the surface that makes rule injection/obedience verifiable (see
[rules/docs/rules-system.md](../../../rules/docs/rules-system.md)): `systemPrompt` shows what was
sent, `output` shows what the model produced — including scratch fields discarded downstream.

> **Model-name fallback.** Anthropic returns `model` in `response_metadata`; Gemini does not
> (only token usage). So the extractor falls back to the bound instance's configured `.model`
> when the response omits it, keeping the `model` column populated for Gemini calls.

## Two bindings: extractor vs adjudicator

`InfraModule` ([infra.module.ts](../../infra.module.ts)) binds the same
`LangchainStructuredExtractor` twice, each wrapped in logging:

| Token | Model | Used for |
|------|------|------|
| `STRUCTURED_EXTRACTOR` | **Gemini** (Flash) | extraction (source services, invoice line items) |
| `ADJUDICATOR_EXTRACTOR` | **Anthropic Haiku** | adjudication / resolution (match, symbol resolve) |

The split follows the system principle *the graph retrieves, the LLM adjudicates* — cheap
extraction on Gemini, careful reasoning on Haiku. Model IDs come from env
([gemini.provider.ts](../../../agents/llm/gemini.provider.ts) /
[anthropic.provider.ts](../../../agents/llm/anthropic.provider.ts)).

## Versioned prompts, and schema as context

A prompt is a `PromptTemplate` — `{ id, version, render }` — and `promptTag` produces the
`id@version` string used as the call's `operation` (and split into `promptId`/`promptVersion` in
the log). Bump (or, on a clean rewrite, reset) the version whenever the prompt's rules change, so
old `llm_call_logs` rows stay mapped to the text that produced them.

**Schema descriptions are model context.** `withStructuredOutput(schema)` compiles the zod schema
— including every field's `.describe()` — into the provider tool schema sent with the request, so
descriptions **count as input tokens** (once per call, not per array item). The convention that
follows: put per-field mechanics in the field's `.describe()` and keep the system prompt to the
global procedure; never duplicate the same instruction in both.

## Key files

- [structured-extractor.port.ts](../structured-extractor.port.ts) — the port
- [langchain.structured-extractor.ts](../langchain.structured-extractor.ts) — provider impl + retry + usage
- [logging.structured-extractor.ts](../logging.structured-extractor.ts) — the audit decorator
- [llm-call-log.repository.ts](../llm-call-log.repository.ts) — `llm_call_logs` row shape
- [infra.module.ts](../../infra.module.ts) — the two bindings
- [prompt.types.ts](../prompt.types.ts) — `PromptTemplate` + `promptTag`
