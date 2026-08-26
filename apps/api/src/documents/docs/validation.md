# Document validation: hard gate + soft vendor match

The `validate` step decides whether an extracted document may proceed. It combines a
**hard financial gate** (rejects) with an **AI vendor match** (only warns), then mirrors
the document onto the graph. Re-runnable.

> The pipeline context is in [ingestion-pipeline.md](./ingestion-pipeline.md). This doc is
> about *what validation enforces and why the two checks differ in severity*.

---

## Hard gate vs. soft warning

| Check | On failure | Where |
|-------|-----------|-------|
| Financial + known attribute set | **reject** (`BadRequestException`) | `isValidFinancialDocument` ([validation.ts](../validation.ts)) |
| Vendor-name match | **warn** (string in `warnings[]`) | `VendorMatcher` ([validation/vendor-matcher.ts](../validation/vendor-matcher.ts)) |

### Why financial is a hard gate
`isValidFinancialDocument` requires `metadata.isFinancial` **and** that the document is
classified into an attribute set that exists for its `documentType` (strict `getAttributeSet`,
no fallback). If either fails, there is **literally nothing downstream to do** — a
non-financial document, or one with no known attribute set, can't produce a rate card. So it's
rejected outright rather than carried forward as a half-document.

### Why vendor mismatch only warns
A vendor-name mismatch is frequently **legitimate** — an alias, abbreviation, rebrand, or
typo. A human can knowingly proceed, so the mismatch is surfaced as a warning, never a block.
Killing ingestion on a name spelling difference would create more false rejections than it
prevents. The severity split is **domain logic** (can we do anything with this doc?), not a
statement about AI confidence.

---

## Pure logic, separately testable

`isValidFinancialDocument` is **pure** — no LLM, no DB ([validation.ts](../validation.ts) is
unit-tested in `validation.spec.ts`). Keeping the gate as a pure function means the
accept/reject decision is exhaustively testable without mocking infrastructure; the
`DocumentsService` just calls it and throws.

---

## Vendor match compares against the registered vendor only

`VendorMatcher.match` feeds the adjudicator two things: the new document's extracted metadata
and the **registered vendor record** (name/code/type/location/**comments**). Aliases,
abbreviations, and rebrands are expected to live in the vendor's `comments` field — that is the
single source of naming variants.

It deliberately does **not** consult the vendor's prior documents. Doing so made validation
**stateful and non-deterministic**: a mismatched document is only *warned*, not rejected, so it
persists as `VALIDATED`. Feeding priors back in let that warned document become naming
precedent — the same wrong invoice, re-uploaded, would match itself and the warning would
vanish (NOM-36). Matching against the registered record alone makes the verdict depend only on
the current document and the vendor, so the same invoice always produces the same result.

It is **skipped** (returns `null`, no warning) when there's no extracted `vendorName` or no
linked `vendorId` — there's nothing to compare. The result is stashed on
`metadata.validation.vendorMatch` for the reviewer.

## Key files

- [validation.ts](../validation.ts) — the pure financial hard-gate
- [validation/vendor-matcher.ts](../validation/vendor-matcher.ts) — AI vendor match (warn-only)
- [helpers/vendor-match.ts](../helpers/vendor-match.ts) — prompt template + formatting
- [schemas.ts](../schemas.ts) — `VendorMatchSchema`, `ExtractionSchema`
- [ingestion-pipeline.md](./ingestion-pipeline.md) — where validate sits in the flow
