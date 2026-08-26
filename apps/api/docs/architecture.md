# apps/api — architecture overview

`apps/api` is the NestJS backend that reconciles vendor **transaction** documents (invoices /
endorsements) against vendor **source** documents (rate cards / quotations). This is the map:
the two data stores, the two pipelines, the LLM roles, and an index into every subsystem doc.

> **The one guiding split.** *The graph retrieves, the LLM adjudicates, the graph reasons.*
> Candidate rates come from Neo4j traversal + Lucene full-text (no embeddings); an LLM promotes
> a candidate into a committed fact; everything downstream is deterministic graph/arithmetic. The
> LLM is paid once, at the candidate→fact boundary.

---

## Two stores

- **Postgres** (TypeORM, `packages/database`) — the platform layer: tenancy/auth, documents +
  content + files, the staging snapshots, and the observability tables (`pipeline_logs`,
  `pipeline_reasoning`, `llm_call_logs`).
- **Neo4j** (`packages/neo4j`) — the domain knowledge graph: vendors, services, canonical
  concepts, line items, `:Rule` nodes, and the typed edges between them, plus the `rule_fulltext`
  / service full-text indexes.

They share only a `tenantId` reference — no cross-store transaction. Details:
[graph-model.md](../src/infra/graph/docs/graph-model.md),
[graph-infrastructure.md](../src/infra/graph/docs/graph-infrastructure.md).

## Two pipelines

```
                        upload → classify → validate           (documents/)
                                    │
              ┌─────────────────────┴─────────────────────┐
        source doc                                  transaction doc
   (rate card / quotation)                        (invoice / endorsement)
              │                                            │
     extract services (Gemini)                    extract line items (Gemini)
              │                                            │
     commit → reconcile canonicals                 adjudicate/match (Haiku)
        (Gemini/Haiku) → :Service                          │
              │                                    resolve symbols (Haiku)
     :CanonicalService + rate card                         │
              └──────────────  the rate card  ───▶  reconcile amounts (deterministic)
                                                           │
                                                    :LineItem status
```

- **Source pipeline** turns a rate card into the committed `:CanonicalService` + `:Service`
  graph (one service node per tier), with supersession chains for rate changes. Docs:
  [canonical-resolution.md](../src/source/docs/canonical-resolution.md),
  [staging-versioning.md](../src/source/docs/staging-versioning.md),
  [commit-and-supersession.md](../src/source/docs/commit-and-supersession.md).
- **Transaction pipeline** extracts an invoice's billed lines (each a `formula` over `symbols`),
  matches each to a canonical service, resolves the contracted `rate` from the rate card, and
  reconciles the computed amount against the billed amount. Docs:
  [line-item-extraction.md](../src/transaction/docs/line-item-extraction.md),
  [matching-and-reconciliation.md](../src/transaction/docs/matching-and-reconciliation.md).

Both pipelines are structured as **facade flows**: one class per pipeline, one thin method per
phase over a single injected collaborator, composed by a `run`/`execute` that owns the control
flow (a shape that maps 1:1 onto a future graph runner).

## LLM roles

Two model bindings behind one `StructuredExtractor` port: **Gemini** for extraction (cheap, high
volume) and **Anthropic Haiku** for adjudication/resolution (careful reasoning). Every call is
schema-validated and logged. Details: [llm-infra.md](../src/infra/llm/docs/llm-infra.md).

Vendors steer any LLM phase with **rules** — category-scoped guardrails injected into the phase's
prompt: [rules-system.md](../src/rules/docs/rules-system.md).

## Document lifecycle (status)

A document moves `VALIDATED → (STAGED) → COMMITTED → MATCHING → MATCHED` (source docs stage/commit
services; transaction docs commit then match). Each phase owns its own status gate; the shared
loader is identity+type only. Source-side state machine:
[document-lifecycle.md](../src/source/docs/document-lifecycle.md); transaction-side
(`COMMITTED → MATCHING → MATCHED`, async matching):
[matching-and-reconciliation.md](../src/transaction/docs/matching-and-reconciliation.md).

## Doc index

| Area | Doc | Covers |
|------|-----|--------|
| Ingestion | [documents/docs/ingestion-pipeline.md](../src/documents/docs/ingestion-pipeline.md) | upload → classify → sections |
| Ingestion | [documents/docs/validation.md](../src/documents/docs/validation.md) | document validation gate |
| Source | [source/docs/document-lifecycle.md](../src/source/docs/document-lifecycle.md) | status state machine (source side) |
| Source | [source/docs/canonical-resolution.md](../src/source/docs/canonical-resolution.md) | naming a service's canonical concept |
| Source | [source/docs/staging-versioning.md](../src/source/docs/staging-versioning.md) | staged snapshots + reviewer edits |
| Source | [source/docs/commit-and-supersession.md](../src/source/docs/commit-and-supersession.md) | commit ordering + `AMENDS` |
| Transaction | [transaction/docs/line-item-extraction.md](../src/transaction/docs/line-item-extraction.md) | invoice → billed line items |
| Transaction | [transaction/docs/matching-and-reconciliation.md](../src/transaction/docs/matching-and-reconciliation.md) | match → resolve → reconcile |
| Rules | [rules/docs/rules-system.md](../src/rules/docs/rules-system.md) | vendor guardrail rules + verification |
| Vendors | [vendors/docs/registry-and-dual-write.md](../src/vendors/docs/registry-and-dual-write.md) | vendor registry + Postgres/Neo4j dual write |
| Graph | [infra/graph/docs/graph-model.md](../src/infra/graph/docs/graph-model.md) | nodes, edges, keys, tenancy |
| Graph | [infra/graph/docs/graph-infrastructure.md](../src/infra/graph/docs/graph-infrastructure.md) | driver, transactions, bootstrap |
| LLM | [infra/llm/docs/llm-infra.md](../src/infra/llm/docs/llm-infra.md) | extractor port, logging, model bindings, prompts |
