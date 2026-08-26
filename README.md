# Nomanbhoy

**Vendor billing reconciliation platform.** It ingests vendor rate cards (quotations, price
lists) and billed documents (invoices, endorsements), then reconciles every charged line against
the contracted rate — surfacing over- and under-charges with a full, auditable trail.

Guiding principle: **the graph retrieves, the LLM adjudicates, the graph reasons.** Candidate
rates come from graph traversal and lexical full-text search (no vector embeddings); an LLM is
paid once, at the candidate→fact boundary, to commit a match; everything downstream is
deterministic graph and arithmetic.

## How it works

Two document pipelines feed one knowledge graph:

- **Source pipeline** — a rate card is classified, extracted into priced service lines, grouped
  under stable canonical concepts, and committed to the graph (one node per tier, with
  supersession chains for rate changes).
- **Transaction pipeline** — an invoice's billed lines are extracted (each as a `formula` over
  symbols), matched to a canonical service, resolved to real numbers from the rate card, and
  reconciled: computed amount vs billed amount → `match` / `mismatch` / `needs review`.

Vendors steer any AI phase with **rules** — per-vendor, per-phase guardrails injected into the
prompts. Full architecture, flows, and subsystem docs live under
[`apps/api/docs/architecture.md`](apps/api/docs/architecture.md).

## Monorepo

Turborepo + pnpm workspace.

| Package | Description |
| --- | --- |
| `apps/web` | React 19 + Vite frontend — TanStack Router/Query, shadcn UI, Tailwind v4 |
| `apps/api` | NestJS REST API — ingestion, extraction, matching, reconciliation |
| `packages/database` | Postgres schema + TypeORM entities & migrations (`@nom/database`) |
| `packages/neo4j` | Neo4j driver + tenant-scoped Cypher layer (`@nom/neo4j`) |
| `packages/dtos` | Shared API DTOs (`@nom/dtos`) |
| `packages/shared` | Shared types & constants (`@nom/shared`) |
| `packages/ui` | Shared shadcn component library (`@nom/ui`) |

## Stack

| Layer | Technology |
| --- | --- |
| Monorepo / build | Turborepo, pnpm |
| Frontend | React 19, Vite, TanStack Router/Query, Tailwind v4, shadcn |
| Backend | NestJS |
| Auth | BetterAuth (Postgres-backed) |
| Platform store | PostgreSQL — tenancy, auth, ingestion, observability |
| Knowledge graph | Neo4j — vendors, services, canonicals, line items, rules (+ Lucene full-text) |
| Extraction LLM | Google Gemini (Flash) |
| Adjudication LLM | Anthropic Claude Haiku |

## Getting started

**Prerequisites:** Node ≥ 20, pnpm 10, Docker (for Postgres / Neo4j / Redis).

```bash
pnpm install
pnpm infra:up        # start Postgres, Neo4j, Redis via docker compose
pnpm db:migrate      # apply database migrations
pnpm dev             # run all apps in watch mode
```

Configure environment variables before first run; `pnpm check-env` validates them.
Use `pnpm be:dev` to run the backend only (everything except `web`).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` / `pnpm be:dev` | Run all apps / backend only, in watch mode |
| `pnpm build` | Build every workspace |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | Static checks / formatting |
| `pnpm test` | Run the test suites |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop local infra (docker) |
| `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:revert` | Generate / run / revert migrations |
| `pnpm check-env` · `pnpm reset-db` | Validate env / reset the database |

## Documentation

- [`apps/api/docs/architecture.md`](apps/api/docs/architecture.md) — backend architecture
  overview and an index of every subsystem doc (pipelines, rules, graph model, LLM infra).

Subsystem docs are co-located with the code under `apps/api/src/**/docs/`.
