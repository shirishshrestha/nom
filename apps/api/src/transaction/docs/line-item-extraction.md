# Transaction line-item extraction

How a committed **transaction** document (an invoice / endorsement) is turned into billed
`LineItem`s, each with a formula, an initial rate-card guess, and the audit trail the
matching pipeline needs. This is phase 1 of reconciliation; matching + reconciliation are in
[matching-and-reconciliation.md](./matching-and-reconciliation.md).

> **Where this sits.** Source (rate-card) documents are extracted by a *different* flow (see
> [source/docs/canonical-resolution.md](../../source/docs/canonical-resolution.md)). This doc
> is the invoice side: the vendor already has a committed rate card in the graph, and we now
> read one invoice and prepare each of its lines to be reconciled against that card.

---

## The flow

`ExtractLineItemsFlow` ([extract-line-items.flow.ts](../extraction/extract-line-items.flow.ts))
is a facade over one collaborator per step, composed by `run`:

```
loadDocument ─▶ loadRegistry ─▶ extract ─▶ persist
   (gate)         (Neo4j)       (Gemini)    (Neo4j + pipeline_logs)
```

- **loadDocument** — `DocumentContextLoader.loadTransactionContext`
  ([document-context.loader.ts](../../shared-loading/document-context.loader.ts)) loads the doc
  + its ordered content sections, gated on an *extraction* status
  (`VALIDATED | PROCESSING | COMMITTED`). The bare `loadTransactionDoc` is identity+type only;
  the status policy lives in this context loader, so a `MATCHING`/`MATCHED` doc can still be
  re-matched but never re-extracted.
- **loadRegistry** — the vendor's canonical services + known tier slugs (Neo4j). This is the
  rate card the extractor matches each line against for its first-pass guess.
- **extract** — `LineItemExtractor` ([line-item-extractor.ts](../extraction/line-item-extractor.ts))
  fans out one Gemini call **per content chunk** (`extractMany`), each returning the chunk's
  billed lines. The system prompt (registry + attribute set + metadata + rules) is identical
  across chunks, so it is rendered **once**.
- **persist** — write the `LineItem` nodes + `HAS_LINE_ITEM` edges to Neo4j and the per-line
  audit log to Postgres `pipeline_logs`.

## The output shape (formula + symbols)

Each line's billed amount is captured as a **formula over symbols**, not a single number, so
reconciliation can recompute it once the contracted rate is known:

- `formula` — a pure-arithmetic expression reproducing the billed total, e.g. `rate * quantity`.
- `symbols` — every symbol in the formula with its value **read from this invoice**. The
  reserved symbol `rate` is always `null` here — the contracted unit rate is filled later from
  the rate card (the resolve phase), never inlined from the invoice's printed unit price.

The exact field rules live in the schema descriptions (`buildLineItemSchema` in
[line-item-schema.ts](../schemas/line-item-schema.ts)) — the system prompt carries only the
global procedure. (Schema `.describe()` strings are sent to the model as the tool schema, so
per-field mechanics live there and are not repeated in the prompt; see
[infra/llm/docs/llm-infra.md](../../infra/llm/docs/llm-infra.md).)

## The initial match guess

Extraction also makes a **first-pass classification** of each line against the rate card, so a
recurring line can often be reconciled with no further ambiguity:

| `initialKind` | Meaning | Fields set |
|------|---------|---------|
| `service_match` | bills one canonical service in the registry | `initialCanonical`, `initialTierSlug` |
| `sibling_ref` | amount computed from OTHER lines in this same invoice | `initialRefSummary` (free text) |
| `unmatched` | no confident canonical, not a sibling | none |

Sibling line UUIDs do not exist yet at extraction time, so a sibling reference is captured as
**free text** (`initialRefSummary`, e.g. "5% of PSA & Depot"); the matching phase resolves it
to real line ids once every line has an id. `matchBasis` is a scratch reasoning field the model
fills first — it is discarded after extraction (it survives only in `llm_call_logs.output`).

## Rules injection

Vendor `LINE_ITEM_EXTRACTION` rules are selected by **section text** (the actual line wording a
rule targets), not the lossy document summary, and injected into the extraction prompt. Selection
+ tracking is described in [rules/docs/rules-system.md](../../rules/docs/rules-system.md).

## Key files

- [extract-line-items.flow.ts](../extraction/extract-line-items.flow.ts) — the facade + step composition
- [line-item-extractor.ts](../extraction/line-item-extractor.ts) — the per-chunk Gemini fan-out
- [line-item-schema.ts](../schemas/line-item-schema.ts) — output schema + system prompt (`transaction.line-item.extract`)
- [document-context.loader.ts](../../shared-loading/document-context.loader.ts) — load + extraction status gate
- [matching-and-reconciliation.md](./matching-and-reconciliation.md) — what happens to these lines next
