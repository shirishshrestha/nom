# Document lifecycle & status state machine

How a source document moves from upload to a committed rate card, what each
`DOCUMENT_STATUSES` value means, and how a document is retired (re-uploaded or
abandoned).

> The document status lives on `DocumentEntity` in Postgres. It is **bookkeeping
> that mirrors where a document is in the pipeline** — it does not by itself drive
> behaviour (there is no formal FSM engine); each phase reads the status it expects
> and advances it. Enforcement is at the entry points (e.g. the re-extract guard),
> not a transition table.

---

## The states

`DOCUMENT_STATUSES` ([packages/shared/src/documents/document.ts](../../../../../packages/shared/src/documents/document.ts)):

| Status | Set where | Meaning |
|--------|-----------|---------|
| `PENDING` | DB column default ([document.entity.ts](../../../../../packages/database/src/entities/document.entity.ts)) | row created at upload, nothing processed yet |
| `EXTRACTED` | `DocumentsService` preprocess | content sectioned + metadata extracted from the file |
| `VALIDATED` | `DocumentsService.validate` | metadata reviewed/accepted; ready for service extraction |
| `STAGED` | `SourceService.extractServices` | priced service lines extracted + staged for review (pre-commit) |
| `COMMITTED` | `SourceService.saveServices` | lines promoted into the graph — terminal, immutable |
| `DISCARDED` | `SourceService.discardForVendor` | reviewer deliberately abandoned this uncommitted doc |
| `SUPERSEDED` | `DocumentsService.persist` | the same file was re-uploaded; this older doc was replaced |
| `REJECTED` | `DocumentsService.validate` | file uploaded but failed a hard-gate check (financial-document, type, or vendor attributeSet mismatch) — filtered out explicitly, not soft-deleted, so it can be re-validated later |

### The happy path

```
PENDING ──preprocess──▶ EXTRACTED ──validate──▶ VALIDATED ──extractServices──▶ STAGED ──saveServices──▶ COMMITTED
```

- `extractServices` is idempotent: re-extracting a `STAGED` doc keeps it `STAGED`
  ([source.service.ts:93-98](../source.service.ts#L93-L98)).
- `COMMITTED` is terminal. Re-extraction after commit is blocked by the
  `isCommitted` guard ([source.service.ts:64-67](../source.service.ts#L64-L67)).

> **Transaction documents continue past `COMMITTED`.** This doc covers *source* (rate-card)
> docs. A committed *transaction* (invoice) doc then moves `COMMITTED → MATCHING → MATCHED` as it
> is reconciled against the rate card (async matching flips it to `MATCHING`; completion →
> `MATCHED`). That side of the machine — and its status gate — is in
> [transaction/docs/matching-and-reconciliation.md](../../transaction/docs/matching-and-reconciliation.md).

### The retirement paths

```
                       ┌─ re-upload same file ──────▶ SUPERSEDED  (+ deletedAt)
(any pre-commit state) ┤
                       └─ reviewer abandons ────────▶ DISCARDED   (+ deletedAt)

EXTRACTED / VALIDATED  └─ fails financial check ───▶ REJECTED    (no deletedAt — see below)
```

---

## Three decisions worth knowing

### 1. `REJECTED` vs `DISCARDED`

Both are terminal, but the trigger differs — and so does whether the row is
soft-deleted:

- **`REJECTED`** — set by `DocumentsService.validate` when a hard-gate check
  (financial-document, type, or vendor attributeSet mismatch) fails. The document
  never made it past the metadata gate; `rejectReason` records why. Unlike
  `SUPERSEDED`/`DISCARDED`, it is **not** soft-deleted, so the same row can be
  re-fetched and re-validated later (e.g. after the underlying data is fixed).
- **`DISCARDED`** — set by `SourceService.discardForVendor` when a reviewer
  deliberately abandons a vendor's uncommitted change-set after it has already
  passed validation.

### 2. `SUPERSEDED` exists at two independent levels

Both the **document** status and the **staged-row** status
([STAGED_STATUSES](../../../../../packages/shared/src/services/service.ts)) have a
`SUPERSEDED` value, and they mean different things at different granularity:

| Level | Set by | Trigger |
|-------|--------|---------|
| Document | `DocumentsService.persist` | the **whole file** was re-uploaded — the prior `DocumentEntity` is replaced |
| Staged row | `StagingRepository.stageExtraction` | a **newer staged version** of the *same* document replaced this snapshot |

This is deliberate. A document can be superseded as a whole (new upload), and
*within* a single document its staged service snapshots are superseded version by
version. The two never collide because they live on different rows.

### 3. `SUPERSEDED`/`DISCARDED` soft-delete; `REJECTED` is filtered explicitly

`SUPERSEDED` and `DISCARDED` documents get *both* a status change and a
`deletedAt` timestamp ([source.service.ts:193-196](../source.service.ts#L193-L196),
[documents.service.ts:143-157](../../documents/documents.service.ts#L143-L157)) —
belt-and-suspenders: `deletedAt` hides the row from every default TypeORM `find`
automatically, while `status` records *why* it's gone, for audit and history.
Both are genuinely terminal — a superseded or discarded doc is never revisited.

`REJECTED` is deliberately different: it does **not** set `deletedAt`, because a
rejected doc should be revalidatable (the caller may fix the issue and retry).
Query sites that must still hide `REJECTED` docs filter it explicitly by status:
`DocumentsService.listDocuments`.

---

## Where the review phase reads the machine

`listUncommittedForVendor` ([source.service.ts:115](../source.service.ts#L115)) is
the document-centric review feed: it returns every `EXTRACTED` / `VALIDATED` /
`STAGED` source doc for a vendor and lets the client drive the next action from
each doc's `status`. Committed and retired (soft-deleted) docs naturally fall out.
Ordering and per-file commit independence are covered in
[commit-and-supersession.md](./commit-and-supersession.md).

## Key files

- [source.service.ts](../source.service.ts) — `extractServices`, `saveServices`, `discardForVendor`, `listUncommittedForVendor`
- [documents/documents.service.ts](../../documents/documents.service.ts) — `PENDING`→`EXTRACTED`→`VALIDATED`, and re-upload `SUPERSEDED`
- [packages/shared/src/documents/document.ts](../../../../../packages/shared/src/documents/document.ts) — `DOCUMENT_STATUSES`
- [staging-versioning.md](./staging-versioning.md) — the staged-row status machine that sits under `STAGED`
