# Document ingestion: extract → validate

How a raw uploaded file becomes a validated document ready for service extraction.
This is the **preprocess half** that runs before the source pipeline
([source/docs/document-lifecycle.md](../../source/docs/document-lifecycle.md)).

> `DocumentsService` ([documents.service.ts](../documents.service.ts)) orchestrates two
> deliberately separate steps; extraction, vendor matching, and the graph mirror each
> live in a dedicated collaborator.

---

## Two phases, on purpose

```
files ──extractMetadata──▶ EXTRACTED ──validate──▶ VALIDATED ──▶ (source pipeline)
        multimodal LLM              financial gate
        metadata + chunks           + vendor match + graph mirror
```

The split is not incidental:

- **Extract is the expensive pass** — it pulls file bytes from S3 and runs the multimodal
  structured extractor over each one. It runs **once, at upload**.
- **Validate is a cheap, re-runnable gate** — financial check + AI vendor-match + graph
  mirror, all over already-extracted metadata. A user can fix the vendor assignment or
  metadata and **re-validate without paying to re-extract** (`validate` is explicitly
  re-runnable and clears `rejectReason`).
- Validation is also the **deliberate checkpoint** before any services are staged — nothing
  reaches the source pipeline until a document passes it.

The validation gate itself is documented in [validation.md](./validation.md).

---

## Extract phase

`extractMetadata` ([documents.service.ts:45](../documents.service.ts#L45)), exposed as
`POST /files/extract-metadata`. The document type comes from each file (set at upload), so
the caller only supplies file ids:

1. **Guard** — load the requested files (org-scoped); reject if any file already has a
   `COMMITTED` document (no re-extracting committed work).
2. **Bounded fan-out** — `DocumentExtractor.extractMany`
   ([extraction/document-extractor.ts:45](../extraction/document-extractor.ts#L45)) caps
   concurrency twice: a `pLimit` over the **S3 fetches** and the extractor's own
   `LLM_MAX_CONCURRENCY` over the **LLM calls**. The S3 cap matters because each file's bytes
   inflate ~1.33× as base64 and are held resident — an unbounded `Promise.all` over many
   large PDFs can OOM. Order-preserving: `result[i]` ↔ `files[i]`.
3. **Persist** per file (independent), then sort results by `validFrom → documentDate →
   fileId`.

### Summary sections are dropped
`toExtracted` filters out `isSummary` sections — recap/summary blocks are never persisted as
content chunks, because they duplicate real sections and would pollute the per-chunk service
extraction downstream.

### One active document per file
`persist` ([documents.service.ts:86](../documents.service.ts#L86)) first retires any prior
live document for the file (anything not already `COMMITTED`/`SUPERSEDED`/`DISCARDED` →
`SUPERSEDED` + `deletedAt`), then inserts the fresh `EXTRACTED` row. So a re-upload replaces
the in-flight document but never touches committed history. (This is the document-level
`SUPERSEDED` described in
[source/docs/document-lifecycle.md](../../source/docs/document-lifecycle.md).)

### effectiveFrom derivation
`effectiveFrom` is `validFrom`, falling back to a parseable `documentDate`, else null — the
same key used to order rate cards for commit-order supersession.

---

## The graph mirror is best-effort

On successful validate, `writeGraph` ([documents.service.ts:195](../documents.service.ts#L195))
mirrors the document's **join key + reasoning fields** onto a `SourceDocument` node — but a
`GraphWriteError` is **logged, not thrown**: validation still succeeds.

This is safe because document metadata is **authoritative in Postgres**; Neo4j only mirrors
the fields the graph reasons over. A failed mirror is not data loss — `commit()` re-upserts
the `SourceDocument` node before writing services, so the graph converges either way. Blocking
validation on a best-effort mirror would be wrong. (Contrast the service commit, which *is*
fatal — see [graph-infrastructure.md](../../infra/graph/docs/graph-infrastructure.md).)

## Key files

- [documents.service.ts](../documents.service.ts) — `extractMetadata`, `persist`, `validate`, `writeGraph`
- [extraction/document-extractor.ts](../extraction/document-extractor.ts) — multimodal extract + bounded fan-out
- [persistence/document.repository.ts](../persistence/document.repository.ts) — prior-document lookups
- [validation.md](./validation.md) — the validate-phase gate
- [../../source/docs/document-lifecycle.md](../../source/docs/document-lifecycle.md) — the status machine these steps advance
