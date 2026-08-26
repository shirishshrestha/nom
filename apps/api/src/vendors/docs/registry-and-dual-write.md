# Vendor registry & dual-write

The vendor is the anchor every rate card hangs off. It lives authoritatively in
Postgres and is mirrored as a bare `:Vendor` node in Neo4j.

> `VendorsService` ([vendors.service.ts](../vendors.service.ts)) is a thin CRUD service
> over `VendorEntity`, plus a graph mirror on create and a graph **read** for the live
> rate card.

---

## Dual-write on create

`create` ([vendors.service.ts:29](../vendors.service.ts#L29)) writes the vendor to Postgres
(authoritative), then mirrors a `:Vendor {id, tenantId}` node into Neo4j.

### The bare anchor
Only `{id, tenantId}` is mirrored — **not** name, type, or any other field. The graph
reasons over services, canonicals, and amendments; the vendor exists there purely as the
`OFFERS` anchor and a traversal target. Name/type are Postgres-authoritative and never read
in Cypher, so mirroring them would just be more state to keep in sync.

### Mirror failure fails the create (with rollback)

A mirror failure is **consequential, not cosmetic**: `commitServices` does
`OPTIONAL MATCH (v:Vendor {id, tenantId})` and skips the `OFFERS` edge when the node is
missing ([service-graph.cypher.ts](../../infra/graph/cypher/service-graph.cypher.ts)). With no
`OFFERS` edge, `listCurrentServices` — which matches `(v)-[:OFFERS]->(s)` — returns **nothing**
for that vendor. So a silently-missing vendor node produces an empty rate card later, far from
the cause.

So the mirror is **required**, and `create` enforces it
([vendors.service.ts:35-52](../vendors.service.ts#L35-L52)): if the Neo4j write throws, it
**rolls back the just-saved Postgres row** (`vendorsRepo.delete`) and throws
`ServiceUnavailableException`. Neither store keeps the vendor, so they can't diverge, and the
caller gets a clear 503 to retry. Ordering matters: Postgres is written first to mint the uuid
id the graph node needs; the compensating delete is what makes throwing safe (a bare throw
would leave the orphan Postgres row).

> Trade-off: this is a compensating-action pattern, not a distributed transaction (the two
> stores can't share one). The window between the Postgres commit and the graph write is
> non-atomic — a process crash *between* them could still orphan a row. If that ever matters,
> the upgrade path is a `graphSynced=false` flag + a reconcile job. For now the rollback covers
> the realistic failure (Neo4j rejects/unreachable).

---

## The live rate card is a graph read

`listCurrentServices` ([vendors.service.ts:81](../vendors.service.ts#L81)) reads the vendor's
current services **from Neo4j**, not Postgres. Committed services and their supersession exist
only in the graph (Postgres staging holds proposals); the live rate card is exactly
"`current=true` services this vendor `OFFERS`" after the amendment chains have run. The
vendor's attribute-set definition is embedded in the response so the frontend renders columns
without a second call.

## Other operations

Plain org-scoped CRUD over `VendorEntity`: `findAll`, `findOne`, `findTypes` (distinct
non-null `type`), `findFiles`, `update`, and `remove` (soft-delete). `remove` does **no** graph
cleanup — consistent with the pipeline's general "leave inert graph nodes, re-MERGE on next
write" stance.

> Note: the `:Vendor` uniqueness constraint is on `id` alone (a uuid, globally unique), unlike
> `:Service`/`:CanonicalService` whose keys include `tenantId`. Queries still anchor on
> `tenantId` for isolation per [graph-model.md](../../infra/graph/docs/graph-model.md).

## Key files

- [vendors.service.ts](../vendors.service.ts) — CRUD + dual-write + live-services read
- [../../infra/graph/docs/graph-model.md](../../infra/graph/docs/graph-model.md) — the `:Vendor` node + `OFFERS` edge in context
