# Vendor rules: guardrails for the LLM phases

Vendors encode domain guardrails as `:Rule` nodes; the pipeline injects the relevant ones into
each LLM phase's system prompt and records which rules touched which document. Rules never run
code — they are *instructions to the model*, selected by relevance and category.

> **Why rules exist.** A vendor's billing has quirks a generic prompt can't know ("Tuas Mega
> Port surcharge is taxed inline", "similar items amend each other"). Rules let a reviewer teach
> the pipeline per vendor, per phase, without a code change.

---

## The node

A `Rule` is a Neo4j node owned by `{vendorId, tenantId}` (indexed props, the same pattern as
`CanonicalService` — no ownership edge), with `title`, `content`, `category`, and timestamps.
CRUD lives in `RulesService` ([rules.service.ts](../rules.service.ts)); the graph layer is
[rule-graph.repository.ts](../../infra/graph/rule-graph.repository.ts) /
[cypher/rule-graph.cypher.ts](../../infra/graph/cypher/rule-graph.cypher.ts).

## Categories → which phase injects which

A rule's `category` decides which LLM phase it is injected into:

| Category | Injected in | Phase / prompt |
|------|------|------|
| `SERVICE_EXTRACTION` / `LINE_ITEM_EXTRACTION` | **document metadata extraction** (per document type) | [documents.service.ts](../../documents/documents.service.ts) (`extractMetadata`, via `extractionCategory`) |
| `SERVICE_EXTRACTION` | source extract | [extract-services.flow.ts](../../source/extraction/extract-services.flow.ts) (`service.extract`) |
| `SERVICE_GROUPING` | source **commit** (canonical re-match) | [commit-services.flow.ts](../../source/commit/commit-services.flow.ts) (`service.canonical-match`) |
| `LINE_ITEM_EXTRACTION` | transaction extract | [extract-line-items.flow.ts](../../transaction/extraction/extract-line-items.flow.ts) (`transaction.line-item.extract`) |
| `MATCHING_RECONCILIATION` | transaction match + resolve | [match-line-items.flow.ts](../../transaction/matching/match-line-items.flow.ts) (`transaction.line-item.match` / `.resolve`) |

The extraction categories are injected **twice**: once at document metadata extraction (the row
above) and again at the corresponding source/transaction extract phase. At metadata extraction
the only relevance query available is the **filename** (`file.name`) — no summary or sections
exist yet — so a vendor above `RULES_PINNED_CORE` effectively gets just the pinned core there.
This is expected, not a defect: the richer section-text query is used at the real extract phase.

Note that `SERVICE_GROUPING` fires at **commit**, not extraction — when staged services are
re-verified against the registry. Each phase calls `rulesFor(...)` with a relevance query drawn
from the content it's about to process (section text, line descriptions, service titles), then
`renderRulesBlock` appends the selected rules to the system prompt as a `Vendor rules` block.

## Selection: pinned core + relevance overflow

`RulesService.rulesFor` ([rules.service.ts](../rules.service.ts)) is size-gated so a long tail of
niche rules never floods the prompt, while a small vendor's rules always all apply:

- At or below `RULES_PINNED_CORE` (10) rules for the category → **inject all** (no relevance
  search — a conceptual rule with no keyword overlap must never be dropped).
- Above that → the **first 10 by `createdAt` are pinned** (always injected), and the remainder
  is narrowed to a Lucene top-K over the phase's context text. Max `10 + K` rules reach the model.

The pinned core is *why* a rule can appear to apply to "every item" — pinned rules are injected
unconditionally, so their scope must be expressed in their **content** wording, not left to the
relevance filter.

## Application tracking (`RULED_BY`)

After injecting, a phase calls `markRulesApplied` (best-effort — tracking never fails a run),
which MERGEs a `RULED_BY` edge from the document to each applied `Rule`, carrying `{phase, at}`.
This is an audit trail of which rules touched which document during which phase; it does not
affect model behaviour.

## Verifying a rule: injection vs obedience

Every LLM call is persisted to `llm_call_logs` (see
[infra/llm/docs/llm-infra.md](../../infra/llm/docs/llm-infra.md)) — both the **system prompt**
and the model's **raw output**. That gives two independent checks:

- **Injection** — search `llm_call_logs.system_prompt` (filter by `prompt_id`, e.g.
  `service.canonical-match`) for the rule's text / the `Vendor rules` block. If it's there, the
  rule *was* injected.
- **Obedience** — search `llm_call_logs.output`. This holds the raw model response, including
  scratch reasoning fields (`nameBasis`, `matchBasis`) that are **discarded downstream** before
  the entity is written. A probe rule ("echo 'seen X' into nameBasis") proves the model obeyed,
  even though the marker never reaches a committed node.

**Caveat — no durable echo for grouping.** `canonicalDescription` is `ON CREATE SET` only (see
[graph-model.md](../../infra/graph/docs/graph-model.md)), so a grouping-phase marker written
there is dropped for an already-existing canonical. Use `llm_call_logs.output` to verify
grouping obedience, not the committed graph.

## Key files

- [rules.service.ts](../rules.service.ts) — CRUD + `rulesFor` selection + `markRulesApplied`
- [rule-graph.repository.ts](../../infra/graph/rule-graph.repository.ts) / [cypher/rule-graph.cypher.ts](../../infra/graph/cypher/rule-graph.cypher.ts) — Neo4j reads/writes + `rule_fulltext` search
- [registry-render.ts](../../common/registry-render.ts) — `renderRulesBlock`
- [infra/llm/docs/llm-infra.md](../../infra/llm/docs/llm-infra.md) — `llm_call_logs` (the verification surface)
