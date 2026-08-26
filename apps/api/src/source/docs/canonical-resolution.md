# Canonical-service resolution

How a vendor's priced service lines get a **canonical name** (the internal grouping
key that becomes a `:CanonicalService` graph node), and how that name is kept
collision-safe and concept-correct from extraction through commit.

> `canonicalName` is **internal** — never shown to reviewers. It is both the dedup
> key and the Neo4j `MERGE` key, so two lines with the same `canonicalName` end up
> grouped under the same concept node. Getting it right is the whole point of this flow.

---

## The pipeline at a glance

```
extract (Gemini)        →   reconcile / verify (Haiku)   →   write + link (Neo4j)
per chunk, proposes          per line, at save time            at commit, the only writer
canonicalName as a           reuse existing / split            MERGE :CanonicalService
string on staged rows        wrong groupings                   + link :Service -[:IS_A]->
```

Three deliberate stages, each with a single job:

| Stage | Where | Model | Writes? | Job |
|-------|-------|-------|---------|-----|
| Extract | [extraction/service-extractor.ts](../extraction/service-extractor.ts) | Gemini (`STRUCTURED_EXTRACTOR`) | Postgres jsonb | Propose a `canonicalName` per line |
| Reconcile | [extraction/canonical-matcher.ts](../extraction/canonical-matcher.ts) | Haiku (`ADJUDICATOR_EXTRACTOR`) | nothing (pure classify) | Verify each line against the registry: reuse or split |
| Write + link | [../infra/graph/cypher/service-graph.cypher.ts](../../infra/graph/cypher/service-graph.cypher.ts) | — | Neo4j | `MERGE` the concept/line nodes + edges |

---

## 1. Extract — propose canonicals as data, not nodes

[service-extractor.ts](../extraction/service-extractor.ts) runs each document content
chunk through the LLM **sequentially**, feeding every call the *running registry*
(existing vendor canonicals + ones minted by earlier chunks) so the model reuses names
instead of inventing duplicates. Each priced line becomes a `StagedService`:

```ts
{ id, canonicalName, canonicalDescription, title, tier, pricingContext, attributes, meta, log }
```

- `canonicalName` is **normalized at the source** via `normalizeCanonical` ([helpers/utils.ts](../helpers/utils.ts)):
  lowercase, trim, collapse non-alphanumeric runs to `_`. So `"Customs Clearance"`,
  `"customs-clearance"`, `"customs  clearance"` all collapse to `customs_clearance`.
- A **tiered** rate becomes N lines that **share one `canonicalName`**, each with its own `tier`.
- These land as **jsonb on the `staged_service_extractions` row in Postgres**. No graph
  nodes exist yet — `canonicalName` is still just a proposed string.

---

## 2. Reconcile — the Haiku adjudicator (save-time)

At `saveServices` ([source.service.ts](../source.service.ts) → `reconcileAll`), every line
is verified against the vendor's existing `:CanonicalService` registry (read via
`CanonicalRegistryRepository.findForVendor`). This runs on the **adjudicator** model.

### Why at save, not at extract
Extraction proposes names fast and cheap per content-chunk with only the *running*
list. Reconciliation runs **once, at save** — *after* the reviewer has corrected
titles/pricing — so the adjudicator judges the human-corrected concept against the
**full** vendor registry, and the (more expensive) Haiku pass is paid once per commit
rather than once per chunk.

### Why a second model
`ANTHROPIC_LLM` (Haiku, `claude-haiku-4-5`) is the designated "Reconciler/Adjudicator".
[infra.module.ts](../../infra/infra.module.ts) binds one provider-agnostic
`LangchainStructuredExtractor` class twice:

```
STRUCTURED_EXTRACTOR   ← GEMINI_LLM      (extraction)
ADJUDICATOR_EXTRACTOR  ← ANTHROPIC_LLM   (reconciliation)
```

`CanonicalMatcher` injects `ADJUDICATOR_EXTRACTOR`.

### Input / output
Per line, the adjudicator sees only the concept-bearing fields **plus the registry**:

```
in:  { id, title, tier, pricingContext, attributes }
       +  registry: { canonicalName, description }[]   +  tiers: { canonicalName, tierSlug }[]
out: { assignments: [ { id, canonicalName, canonicalDescription, tierSlug }, ... ] }  // one per line, id echoed
```

Two prompt rules ([service-schema.ts](../service-schema.ts) `CANONICAL_MATCH_PROMPT`):

1. **Reuse** — a line that is the same concept as a registry entry gets that existing `canonicalName`.
2. **Split** — lines that are *different* concepts get different names, even if worded similarly
   (judge by title + pricing, not surface text).

### Two failure modes it fixes
- **Under-merge** (one concept, two names) → mapped onto a single existing name.
- **Over-merge** (two concepts, one name) → split into two names. This is only possible because
  the output is **per-line (id-keyed)**, not one-per-canonical.

### Batching (context control)
`match()` does not send one giant prompt:

1. **Group** lines by their current `canonicalName`.
2. **Pack** whole groups into batches of ≤ `RECONCILE_BATCH_SIZE` (**12**) lines — **never split a group**.
3. **Run batches sequentially with a registry that grows as it goes.** Each batch's
   prompt carries the canonical names **and tier slugs** minted by earlier batches, so
   the same concept/band converges *across* batches — the cross-batch guard the prompt
   alone can't give. (A name minted in batch 1 must be visible to batch 2, which a
   parallel fan-out can't share — this sequential pass replaced an earlier parallel
   `extractMany` design.) Cold start (empty registry) self-seeds from batch one.
4. **Strip `canonicalName` from the payload** — the model judges fresh from title/tier/pricing so the
   extractor's proposed name can't anchor a split.
5. **Validate one assignment per line, retry once, else throw** — the model must echo
   exactly one assignment per input id. A missing/duplicated id would silently leave a
   line unreconciled (it would commit with a stale/wrong canonical), so a half-matched
   batch is never accepted: one retry absorbs a transient format slip, a second failure
   surfaces a real prompt/schema bug.
6. **Merge** the per-batch `id→assignment` maps; normalize the returned names + tier slugs.

Group-batching keeps a concept's tier-rows judged together (consistent) **and** keeps over-merged rows
co-located in one call (splittable). `ponytail:` sequential is fine for rate-card sizes (1–3 batches);
re-introduce bounded concurrency only if one vendor doc ever fans out wide.

### Apply (local diff)
The adjudicator echoes **all** lines (an "echo every id" contract is robust and lets us validate
count-in == count-out; the model can't know what "changed" since we hid the prior name). We compute
the diff ourselves and only mutate + log lines that actually moved:

```ts
for (const s of services) {
  const hit = resolved.get(s.id);
  if (!hit) continue;
  if (hit.canonicalName === s.canonicalName &&
      hit.canonicalDescription === s.canonicalDescription &&
      hit.tierSlug === s.tierSlug) continue;   // unchanged → skip
  s.canonicalName = hit.canonicalName;
  s.canonicalDescription = hit.canonicalDescription;
  s.tierSlug = hit.tierSlug;
  s.log = `${s.log}\n· canonical reconciled by …`;
}
```

### Conditional re-version
After reconcile, `saveServices` change-detects (`before !== after`). If edits or reconciliation
changed anything, a **new `origin=save` staging version** is created (superseding priors) and committed;
otherwise the existing row is committed in place.

---

## 3. Write + link — the only writer (commit)

[service-graph.cypher.ts](../../infra/graph/cypher/service-graph.cypher.ts) `commitServices` runs one
`UNWIND $rows` and `MERGE`s nodes/edges idempotently per line:

| Node / edge | Key | Meaning |
|-------------|-----|---------|
| `:CanonicalService` | `MERGE {canonicalName, vendorId, tenantId}` | the concept; `ON CREATE SET` description/category — where a *new* canonical is born |
| `:Service` | `MERGE {id, tenantId}` | the priced line (one per tier) |
| `:Attributes` | `MERGE {serviceId, tenantId}` | the rate bag |
| `(s)-[:IS_A]->(c)` | | line → its canonical concept |
| `(d)-[:DEFINES]->(s)` | | source document → line |
| `(v)-[:OFFERS]->(s)` | | vendor → line (if vendor known) |
| `(s)-[:HAS_ATTRIBUTES]->(a)` | | line → attribute bag |

Many `:Service` nodes (across tiers, documents, and time) all `IS_A` the **same** `:CanonicalService` —
that grouping is exactly what the adjudicator guaranteed.

### Amendment chain (supersede-all)
The same cypher finds **every** `current` prior service of the same concept+tier from a
*different* document (untiered / null-slug lines match by concept alone — "no band" is
treated as its own matchable band), links the new line ahead of the newest with `AMENDS`
for a linear audit chain, and retires **all** stale priors:

```cypher
WITH ... collect(prior) AS priors          // newest-first
FOREACH (p IN priors[0..1] | MERGE (s)-[:AMENDS]->(p))           // audit edge → newest only
FOREACH (p IN priors        | SET p.current = false, p.validTo = coalesce($validFrom, $now))
```

So a newer rate card supersedes the old one in-graph. **Supersede-all** (not a single
`LIMIT 1` prior) is deliberate: if a band ever had 2+ concurrent `current` rows — a
pre-existing corruption — a re-commit now heals it instead of orphaning the extras. See
[commit-and-supersession.md](./commit-and-supersession.md) for why that illegal state is
prevented going forward (`dedupeByBand`) and why commit-order decides which rate is live.

---

## The boundary that keeps this safe

- **Postgres staging** holds proposals (jsonb) and survives review/edits.
- The **commit `MERGE` is the single writer** of canonical/service nodes — idempotent, so re-committing
  never duplicates, and node creation + reuse are one atomic operation.
- **Normalization** (extract) and the **adjudicator** (save) exist only to make that `MERGE` key
  collision-safe and concept-correct *before* it runs. The adjudicator never touches the DB or graph —
  it's pure classify, so it's trivially testable (mock the extractor, assert the map) and a bad LLM call
  can't corrupt the graph directly.

## Known limitation / upgrade path
The registry is sent **whole** with every batch (it's the lookup table). Fine for normal vendors; if a
vendor ever accumulates hundreds of canonicals, that becomes the dominant context cost. Marked with a
`ponytail:` comment in `canonical-matcher.ts` — the fix is a registry pre-filter, deferred until a vendor
actually hits that scale.

## Key files
- [extraction/service-extractor.ts](../extraction/service-extractor.ts) — extract + normalize
- [extraction/canonical-matcher.ts](../extraction/canonical-matcher.ts) — the adjudicator (batched, Haiku)
- [service-schema.ts](../service-schema.ts) — schemas + prompts (`CANONICAL_MATCH_PROMPT`)
- [source.service.ts](../source.service.ts) — `saveServices` / `reconcileAll` orchestration
- [helpers/utils.ts](../helpers/utils.ts) — `normalizeCanonical`
- [../infra/graph/cypher/service-graph.cypher.ts](../../infra/graph/cypher/service-graph.cypher.ts) — commit MERGE + amendment chain
- [../infra/infra.module.ts](../../infra/infra.module.ts) — Gemini vs Haiku extractor bindings
