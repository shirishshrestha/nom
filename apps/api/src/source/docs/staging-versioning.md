# Staging: versioned snapshots & the advisory lock

How reviewed service lines are held in Postgres between extraction and commit,
why every change is an **immutable new version** rather than an in-place edit, and
how concurrent writers are serialized.

> All of this lives in `StagingRepository`
> ([staging/staging.repository.ts](../staging/staging.repository.ts)) over the
> `StagedServiceExtractionEntity` table. `SourceService` never touches the table
> directly — versioning and concurrency stay here.

---

## The row and its statuses

Each staged row is a full snapshot of a document's service lines (jsonb) plus
bookkeeping. Status machine ([STAGED_STATUSES](../../../../../packages/shared/src/services/service.ts)):

```
staged ──markCommitted──▶ committed        (stays live, NOT soft-deleted)
  │
  └─ re-extract / re-save / discard ──▶ superseded  (+ deletedAt)
```

`origin` records who produced the snapshot: `extract` (machine) or `save`
(human-reviewed). **Invariant: at most one live (non-soft-deleted) row per
document.**

---

## Why versioned snapshots, not in-place edits

Every extract and every human save inserts a **new row with an incremented
`version`** and supersedes the previous live row — it never mutates one row in
place. The live read path (`latestFor`) only ever reads `MAX(version)`, so the
history is not needed to *operate*; it is kept deliberately as an **immutable
audit / debug trail**:

- Each machine extraction and each human save is a frozen snapshot you can inspect
  after the fact — what the LLM proposed vs. what the reviewer committed.
- `version` is **monotonic and never reused**, even across supersession, because
  `nextVersion` counts with `withDeleted()`
  ([staging.repository.ts:76-89](../staging/staging.repository.ts#L76-L89)) — so the
  numbers themselves prove ordering.

The cost (extra rows) is trivial at rate-card scale and buys a clean audit trail,
so insert-new beats mutate-in-place.

---

## Why the advisory lock — and why it's writer-only

`stageExtraction` retires the live row and inserts the next version inside one
transaction, guarded by a per-document advisory lock
([staging.repository.ts:96-137](../staging/staging.repository.ts#L96-L137)):

```sql
SELECT pg_advisory_xact_lock(hashtext('<org>:<doc>'))
```

### What the lock guards
Two `stageExtraction` calls for the **same document** racing would each read the
same `MAX(version)` and both insert — leaving two live `staged` rows (or a
duplicated version). The lock **serializes the read-MAX → supersede → insert
sequence per document**, closing that window.

### How `pg_advisory_xact_lock` works here
- It's an **advisory** lock: Postgres attaches it to an integer key you choose, not
  to any row or table. It only blocks callers that request the **same key**. Code
  that doesn't call it is unaffected.
- The **`xact`** variant is scoped to the transaction — auto-released on COMMIT or
  ROLLBACK. It can never leak, even on error.
- The key is `hashtext("<org>:<doc>")`, so the lock identity *is* the (org, doc)
  pair. Same doc → serial; different docs → concurrent.

### It does NOT lock readers
The lock is **writer-only** — `stageExtraction` is its sole caller. Readers
(`latestFor`, `latestUncommittedForVendor`, `nextVersion`) run lock-free and rely
on Postgres MVCC: because the supersede + insert are one transaction, a concurrent
reader sees either the fully-old or the fully-new snapshot, never a torn state. The
`SELECT` wrapping the lock call is just the invocation syntax — it is not locking a
read.

---

## Lock vs. the unique index — different problems

A comment notes a deferred *partial unique index* on
`(organizationId, documentId) WHERE status='staged'`. The lock and the index are
**not redundant — they guard different failure classes**:

| | Advisory lock | Partial unique index |
|--|--|--|
| Kind | concurrency / ordering control | data-integrity invariant |
| Stops | two simultaneous writers interleaving (the race window) | more than one live `staged` row from *any* writer, including a future code path that bypasses `stageExtraction` |
| When | only while two txns overlap | always, at the DB level |

The lock keeps the normal path off the constraint entirely (no constraint-violation
catch/retry UX); the index would be the hard backstop against code that never takes
the lock. Both are intended; the index is deferred until the migration is generated.

## Known ceiling

`hashtext` is 32-bit, so two *different* (org, doc) strings can hash-collide and
serialize against each other needlessly. This is **harmless** — a collision only
makes two unrelated documents briefly wait on one lock (a rare, correct slowdown);
it never corrupts data. Upgrade path if it ever matters: the two-argument
`pg_advisory_xact_lock(int4, int4)` keyed on stable ids, or a uuid-derived bigint.

## Key files

- [staging/staging.repository.ts](../staging/staging.repository.ts) — versioning, advisory lock, supersede
- [packages/shared/src/services/service.ts](../../../../../packages/shared/src/services/service.ts) — `STAGED_STATUSES`, `STAGED_ORIGINS`
- [document-lifecycle.md](./document-lifecycle.md) — the document status that sits above these rows
