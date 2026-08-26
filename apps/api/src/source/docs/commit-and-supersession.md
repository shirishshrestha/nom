# Commit & supersession

What happens when a reviewer commits a rate card: how `saveServices` decides
whether to re-stage, why the graph write is fatal-on-failure, how duplicate lines
are collapsed, and how a newer rate card supersedes an older one.

> Commit is the **only** point where reviewed lines enter Neo4j. The graph is the
> source of truth for committed services; everything here exists to make that write
> safe, idempotent, and correctly ordered. See
> [canonical-resolution.md](./canonical-resolution.md) for how the canonical names
> are made collision-safe *before* this runs.

---

## saveServices, end to end

[source.service.ts:228-304](../source.service.ts#L228-L304):

```
overlayEdits (apply reviewer edits)
  → reconcileAll  (Haiku verifies each canonical vs the vendor registry)
  → dedupeByBand  (collapse lines that now share (canonicalName, tierSlug))
  → changed?  yes → stage a new origin=save version   no → commit latest in place
  → commit    (write to graph — FATAL on failure)
  → markCommitted + doc status COMMITTED
```

### Re-stage only when the reviewer changed something

A new staged version is minted **only if** the reviewer made edits or deletions
**and** those actually changed the lines
(`hasReviewerChanges && JSON.stringify(after) !== before`); otherwise the existing
row is committed in place
([commit-services.flow.ts](../commit/commit-services.flow.ts) `dedupe`).
System-side canonical reconciliation alone **never** creates a version — its
changes are applied to the latest snapshot and committed to the graph in place,
unversioned.

Versions are an audit trail of **reviewer intent**, so a version should mean a
real human change. Minting one on a no-op save — or because the background
reconciler shifted a canonical — would churn history with snapshots no human
authored and obscure the signal (was this a genuine edit or just a re-click?).
Commit-in-place keeps every version meaningful and skips a pointless write.

### The graph write is FATAL

`commit()` ([source.service.ts:351](../source.service.ts#L351)) does not catch graph
errors — a failure throws and propagates, so the document is **not** advanced to
`COMMITTED`.

Because the graph is authoritative for committed services, a partial or failed graph
write must never leave Postgres saying `COMMITTED` while the graph disagrees.
Throwing leaves the doc `STAGED` so the reviewer can safely retry the whole commit —
and retry *is* safe because the commit `MERGE` is idempotent (see
canonical-resolution.md). No half-committed state is reachable.

---

## dedupeByBand — collapsing intra-document duplicates

[helpers/utils.ts](../helpers/utils.ts) `dedupeByBand`, called after `reconcileAll`
([source.service.ts:255-258](../source.service.ts#L255-L258)).

After reconciliation, two staged lines can share the graph supersession key
`(canonicalName, tierSlug)` — e.g. the same flat fee was mentioned three times in one
PDF (the original duplicate-services bug). The graph has no key to keep them apart;
committed as-is they would land as **concurrent `current=true` rows on one
canonical** — corruption.

### Why keep-last, drop the rest (no merge)

When two lines share `(canonicalName, tierSlug)` the system has **already judged
them the same priced line of the same concept**. If their attributes differ there is
no meaningful union — you'd get a row with contradictory rates. The later line is
simply the document's authoritative word on that line, so `dedupeByBand` keeps the
**last** occurrence and appends a `· merged duplicate of <id>` note to its log for
the audit trail. Union would be worthless and risk a Frankenstein row.

### Why after reconcile, not at extract

Pre-reconcile, two same-name flat lines might be a **mis-group the matcher will
split** into distinct concepts. Collapsing early could destroy a real distinction.
So dedup runs only *after* reconcile has had its say; the lines that *still* collide
are true duplicates by the system's own identity model. Showing the duplicates in
the review UI until commit is intentional and informative — the collapse is silent
and happens at the last moment.

### Two supersession mechanisms — don't confuse them

`dedupeByBand` is the **intra-document** case. It is *not* a financial amendment —
the commit Cypher deliberately excludes same-document priors. Cross-document
supersession is a separate mechanism:

| | Same document | Across documents |
|--|--|--|
| Mechanism | `dedupeByBand` (keep-last) | graph `AMENDS` + `current=false` |
| Meaning | de-duplicate one card's repetition | financial supersession of an older rate |
| Where | [helpers/utils.ts](../helpers/utils.ts) | [service-graph.cypher.ts](../../infra/graph/cypher/service-graph.cypher.ts) |

---

## Cross-document supersession — commit order wins

When a line is committed, the commit Cypher finds the most-recent `current` prior
service of the **same concept + tier from a different document**, links the new line
ahead of it with `AMENDS`, and retires every stale prior (`current=false`,
`validTo` set). So **the last commit becomes the live (`current=true`) rate.**

### Commit order is the authority

Which rate ends up live is decided by **commit order**, not by `effectiveFrom`. To
make that line up with chronology, `listUncommittedForVendor` sorts the vendor's
in-review docs **oldest-first** ([source.service.ts:130-144](../source.service.ts#L130-L144))
so committing top-to-bottom makes the newest card the last commit = the live one.

This is deliberate: last-commit-wins is simple and reviewer-controlled, and the
`AMENDS` chain records full history either way. The sort is a **nudge, not
enforcement** — a reviewer who commits out of order could leave an older rate
`current`. That fragility is the known ceiling; the upgrade path is to select
`current` by `validFrom`/`effectiveFrom` instead of commit order.

### Per-file commit independence

Committing one file does **not** touch the vendor's other in-review docs
([source.service.ts:292-295](../source.service.ts#L292-L295)). A reviewer can commit
one rate card and keep editing others; overlapping rates between files are reconciled
per-service by the `AMENDS` chain at each commit, so order-of-commit resolves
conflicts with no need to batch. Abandoning siblings is a separate explicit action
(`discardForVendor`).

### A committed rate card must have a vendor

`commit()` throws if `document.vendorId` is missing
([source.service.ts:358-361](../source.service.ts#L358-L361)). `CanonicalService`
MERGEs on `{canonicalName, vendorId, tenantId}`; with `vendorId = null` **every**
vendorless canonical for the tenant collapses onto one shared `{vendorId:null}` node
— cross-vendor corruption. The throw is a hard guard against that.

## Key files

- [source.service.ts](../source.service.ts) — `saveServices`, `commit`, `listUncommittedForVendor`
- [helpers/utils.ts](../helpers/utils.ts) — `dedupeByBand`
- [../infra/graph/cypher/service-graph.cypher.ts](../../infra/graph/cypher/service-graph.cypher.ts) — commit MERGE + `AMENDS` supersession
- [canonical-resolution.md](./canonical-resolution.md) — making the canonical key correct before commit
- [document-lifecycle.md](./document-lifecycle.md) — the document status this advances to `COMMITTED`
