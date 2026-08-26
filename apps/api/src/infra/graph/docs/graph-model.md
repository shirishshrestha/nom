# The domain graph: model, keys & tenancy

Why the billing-reconciliation domain lives in Neo4j (not Postgres), how its nodes
and edges are keyed, and the invariants every query must uphold.

> **Two-store split.** Postgres is the platform/SaaS layer (tenancy, auth, ingestion
> queue, staging, file refs). Neo4j is the **domain knowledge graph** — vendors,
> services, canonical concepts, and the typed edges between them. This doc is about
> the graph half; the commit *mechanics* (supersede-all, `AMENDS`) are in
> [source/docs/commit-and-supersession.md](../../../source/docs/commit-and-supersession.md).

---

## Why a graph store for the domain

The domain *is* a graph, and the core operation — finding the right rate for a billed
line — is graph traversal, not row lookup:

```
(Vendor) ─OFFERS─▶ (Service) ─IS_A─▶ (CanonicalService)
                      │  ▲                    ▲
            HAS_ATTRIBUTES │ AMENDS            │ IS_A (many services, one concept)
                      ▼  │                    │
                 (Attributes)   (prior Service, current=false)
   (SourceDocument) ─DEFINES─▶ (Service)
```

- **Supersession is a chain.** A newer rate `AMENDS` the prior current one — a linear
  audit history per concept+band. Modeling and walking that in SQL (recursive CTEs over
  a self-referential table) is painful; in the graph it's one `MATCH`.
- **Candidate retrieval is traversal + full-text.** Matching an invoice line to a rate
  uses Neo4j traversal plus Lucene full-text on `Service.title` / `CanonicalService.canonicalName`
  — **no vector embeddings**. The LLM adjudicates; the graph reasons deterministically.
- **Multi-hop reasoning** (vendor → its current services → their concepts → amendment
  history) is the read pattern, which is exactly what a property graph is for.

## The nodes & edges

Labels and relationship types have a single source of truth in
[graph-labels.ts](../graph-labels.ts) (`GRAPH_NODES`, `GRAPH_RELS`) — inline Cypher and
the schema bootstrap interpolate these constants so a label can never drift between
writer, reader, and constraint.

| Node | MERGE key | Meaning |
|------|-----------|---------|
| `CanonicalService` | `{canonicalName, vendorId, tenantId}` | the concept / grouping node; `description`,`category` set on-create only |
| `Service` | `{id, tenantId}` | one priced line (per tier); `current` flag + temporal bounds |
| `Attributes` | `{serviceId, tenantId}` | the per-line rate/billed bag (shared by `Service` and `LineItem`) |
| `Vendor` | `{id}` (unique) | the vendor |
| `SourceDocument` | `{id, tenantId}` | the rate card a line was defined by |
| `TransactionDocument` | `{id, tenantId}` | an invoice/endorsement being reconciled |
| `LineItem` | `{id, tenantId}` | one billed line of a transaction; carries `formula` + `symbols`, `matchKind`, review `status` |
| `Rule` | `{id, vendorId, tenantId}` | a vendor guardrail rule injected into an LLM phase (see [rules-system.md](../../../rules/docs/rules-system.md)) |

The first five nodes are the **source (rate-card) subgraph**; `TransactionDocument` /
`LineItem` are the **transaction subgraph** that reconciles an invoice against it; `Rule` is
orthogonal (vendor-owned, referenced by both pipelines).

| Edge | Meaning |
|------|---------|
| `IS_A` | service → its canonical concept |
| `DEFINES` | source document → service |
| `OFFERS` | vendor → service (only when a vendor exists) |
| `HAS_ATTRIBUTES` | `Service`/`LineItem` → its attribute bag |
| `AMENDS` | newer service → the prior current one it supersedes (audit chain) |
| `HAS_LINE_ITEM` | transaction document → a line it bills |
| `BILLED_AS` | line item → the `CanonicalService` it bills (the committed service match) |
| `REFERENCES` | line item → a sibling line its amount is computed from (same transaction) |
| `RULED_BY` | document → a `Rule` applied to it during a phase; carries `{phase, at}` (tracking only) |

### The transaction subgraph

```
(TransactionDocument) ─HAS_LINE_ITEM─▶ (LineItem) ─BILLED_AS─▶ (CanonicalService)
                                          │  │
                              HAS_ATTRIBUTES │  └─REFERENCES─▶ (LineItem)   (sibling, same doc)
                                          ▼
                                     (Attributes)   (billed values)
```

A `LineItem` links to the **same** `CanonicalService` concept the rate card defines, so a
billed line and its contracted rate meet at one node — matching is a traversal, not a join.
`REFERENCES` captures a composite line (e.g. "5% of PSA & Depot") pointing at the sibling
lines it is computed from. How these edges are produced — extract → adjudicate → resolve →
reconcile — is in
[transaction/docs/matching-and-reconciliation.md](../../../transaction/docs/matching-and-reconciliation.md).

The `CanonicalService` key is backed by a **uniqueness constraint**
`(canonicalName, vendorId, tenantId)` ([neo4j.service.ts](../../../../../../packages/neo4j/src/neo4j.service.ts)).
Because `canonicalName` is normalized at the source (`normalizeCanonical`), this exact-match
key is collision-safe — no normalization happens in Cypher. See
[canonical-resolution.md](../../../source/docs/canonical-resolution.md) for how the name is
made correct *before* it becomes a key.

## Tenancy is enforced by convention

There is **one shared graph** for all tenants. Isolation is `tenantId` on every node and
in **every** `MATCH`/`MERGE` — there is no row-level security or per-tenant database.

- Every MERGE key above includes `tenantId`; the canonical uniqueness constraint includes
  it too, so two tenants can mint the same `canonicalName` for the same `vendorId` without
  colliding.
- **Invariant every query MUST uphold:** anchor on `tenantId`. Omitting it from a single
  `MATCH` is a cross-tenant leak. This is the one rule the graph layer can't enforce for
  you — it's convention, chosen for the simplicity/cost of a single shared database over
  database-per-tenant.

## `current` flag + temporal bounds — why both

A `Service` carries a denormalized `current: true|false` **and** `validFrom` / `validTo`:

- **`current` is the fast "live rate" filter** — `CURRENT_SERVICES_CYPHER` selects
  `Service {current:true}` with no date math and no "max validFrom" subquery, and it's
  index-friendly.
- **`validFrom`/`validTo` preserve the temporal record** — when a rate was in force, for
  history and audit.

They can't drift: the supersede-all commit flips `current=false` and stamps `validTo` on
every retired prior in the same write that sets the new line `current=true`
([service-graph.cypher.ts](../cypher/service-graph.cypher.ts)). So the flag is a
deterministic denormalization of "the newest committed line for this concept+band," not a
second source of truth.

## Key files

- [graph-labels.ts](../graph-labels.ts) — node/edge label constants (single source of truth)
- [cypher/service-graph.cypher.ts](../cypher/service-graph.cypher.ts) — commit MERGE + supersede-all + current rates
- [../../../../../../packages/neo4j/src/neo4j.service.ts](../../../../../../packages/neo4j/src/neo4j.service.ts) — uniqueness constraint + indexes
- [graph-infrastructure.md](./graph-infrastructure.md) — driver, transactions, bootstrap, error taxonomy
- [../../../source/docs/commit-and-supersession.md](../../../source/docs/commit-and-supersession.md) — commit ordering + `AMENDS` mechanics
