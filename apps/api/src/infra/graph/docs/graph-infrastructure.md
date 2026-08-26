# Graph infrastructure: driver, transactions, bootstrap, errors

The mechanical layer between business code and the Neo4j driver — how queries run,
how the schema is created, how driver values are unwrapped, and how failures are
typed so each caller can decide whether a graph error is fatal.

> The domain model (why a graph, the nodes/keys, tenancy) is in
> [graph-model.md](./graph-model.md). This doc is the plumbing.

---

## One session per call, driver-managed transactions

`Neo4jService` ([packages/neo4j/src/neo4j.service.ts](../../../../../../packages/neo4j/src/neo4j.service.ts))
exposes exactly two methods — `read` and `write` — each opening a session, running the
Cypher inside `executeRead` / `executeWrite`, and closing the session in `finally`:

```ts
async write(cypher, params) {
  const session = this.driver.session();
  try { return (await session.executeWrite(tx => tx.run(cypher, params))).records; }
  finally { await session.close(); }
}
```

- **Session per call** keeps the API trivial — no session lifecycle leaks into business
  code, and the driver's connection pool handles reuse underneath.
- **`executeWrite`/`executeRead` are managed transactions**: the driver automatically
  retries them on transient errors (leader switch, deadlock) — which is why a whole commit
  is expressed as one Cypher statement (it must be idempotent to be safely retried; the
  commit `MERGE` is).
- Each call is **one autocommit transaction**. There is no cross-call transaction; a commit
  is atomic precisely because it's a single `executeWrite`.

## Schema bootstrap — in code, idempotent, non-fatal

Constraints and indexes (incl. the two full-text indexes used for candidate retrieval) are
created on module init, one statement per call (Neo4j forbids multiple schema commands in one
query):

- **In code, not a migration tool.** Every statement is `IF NOT EXISTS`, so re-running on
  every boot is safe and there's no separate Neo4j migration tooling to maintain.
- **Non-fatal.** A bootstrap failure is logged and boot continues, so a transient Neo4j
  hiccup at startup can't crash-loop the API; the constraints converge on a later boot.
- **Trade-off (documented ceiling):** if Neo4j was down at init, the app can briefly run
  before a constraint exists. Acceptable because the writers don't rely on the constraint for
  correctness (the `MERGE` keys are explicit); the constraint is a backstop, not the
  mechanism.

## Unwrapping driver values

neo4j-driver returns integers as a wrapped `Integer` (`.toNumber()`), not a JS number.
[graph-record.ts](../graph-record.ts) centralizes the unwrap so **no business code touches
driver internals**:

| Helper | Behaviour |
|--------|-----------|
| `getString` | non-null accessor — throws `GraphReadError` rather than let a null masquerade as a string |
| `getNullableString` | `string \| null` |
| `getNumber` | unwraps wrapped `Integer` → number; null → 0 |
| `getAttributes` | unwraps a `properties(node)` map, converting any wrapped integers |

`getString` failing fast on null is deliberate: a missing field is a bug in the query or
write, and surfacing it at read time beats propagating a silent null into the DTO.

## Typed errors → per-call fatality

[graph-error.ts](../graph-error.ts) defines `GraphWriteError` and `GraphReadError` so callers
can tell a graph problem from any other error and choose fatality **per call**:

- **Service commit is FATAL** — `ServiceGraphRepository.commitServices` lets the error
  propagate so the document is not advanced (the graph is authoritative; no half-commit). See
  [commit-and-supersession.md](../../../source/docs/commit-and-supersession.md).
- **Document mirror is a logged warning** — mirroring document metadata into the graph is
  best-effort; a failure there shouldn't block the Postgres-authoritative flow.

### The no-op-write guard

`commitServices` asserts `serviceCount === rows.length` and throws otherwise
([service-graph.repository.ts:86-92](../service-graph.repository.ts#L86-L92)). Why: the
aggregating `RETURN count(...)` always yields one `{0,0}` row **even when the initial
`SourceDocument` MATCH found nothing** — so a write that silently did nothing (e.g. the
document node was never created) would masquerade as success and wrongly advance the doc to
`COMMITTED`. Asserting every input row produced a `Service` turns that silent no-op into a
fatal error.

## Repo-per-aggregate split

The graph layer is three repositories, each with its own Cypher file:

| Repository | Cypher | Owns |
|------------|--------|------|
| `ServiceGraphRepository` | `service-graph.cypher.ts` | commit services + read current rates |
| `DocumentGraphRepository` | `document-graph.cypher.ts` | mirror document nodes |
| `CanonicalRegistryRepository` | `canonical-registry.cypher.ts` | read the vendor's canonical/tier registry for reconciliation |

Split by aggregate (not one god-repo) so each concern's Cypher is co-located and testable in
isolation, and the reconciliation read path doesn't depend on the commit write path.

## Key files

- [../../../../../../packages/neo4j/src/neo4j.service.ts](../../../../../../packages/neo4j/src/neo4j.service.ts) — driver wrapper + schema bootstrap
- [graph-record.ts](../graph-record.ts) — driver value unwrap helpers
- [graph-error.ts](../graph-error.ts) — `GraphWriteError` / `GraphReadError`
- [service-graph.repository.ts](../service-graph.repository.ts) — commit + current rates + no-op guard
- [graph-model.md](./graph-model.md) — the domain model these repos write
