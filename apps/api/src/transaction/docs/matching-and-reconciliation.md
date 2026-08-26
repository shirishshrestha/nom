# Transaction matching & reconciliation

How a transaction document's billed `LineItem`s are reconciled against the vendor's rate card:
each line is matched to a canonical service, its formula symbols are resolved to real numbers,
and the computed amount is checked against what was billed. Extraction (phase 1) is in
[line-item-extraction.md](./line-item-extraction.md).

> **The core idea.** A billed line carries a *formula* (`rate * quantity`) with `rate` left
> null at extraction. Matching links the line to its contracted service; resolution fills
> `rate` from that service's rate card; reconciliation evaluates the formula and compares the
> result to the billed total. Matching is a graph traversal + one LLM adjudication; everything
> after is deterministic arithmetic.

---

## The flow

`TransactionMatchFlow` ([match-line-items.flow.ts](../matching/match-line-items.flow.ts)) is a
facade over one collaborator per phase; `run` (whole doc) and `runForLine` (single-line rerun)
both call `execute`, which owns the only control flow:

```
loadDocument ─▶ loadLineItems ─▶ loadRules ─▶ loadRegistry ─▶ adjudicate ─▶ persistMatches
   (status gate)     (Neo4j)       (rules)      (Neo4j)        (Haiku)        (Neo4j + logs)
        │
        ▼
   loadRateCard ─▶ resolveSymbols ─▶ composeReferencedExpressions ─▶ resolveSiblingSymbols ─▶ reconcileAmounts ─▶ persist
     (Neo4j)         (Haiku)          (Haiku, gated)                   (Haiku)                 (deterministic)   (Neo4j + logs)
```

| Phase | Collaborator | Reads | Writes |
|------|------|------|------|
| loadDocument | `DocumentContextLoader` | Postgres doc + status | — (gates `COMMITTED\|MATCHING\|MATCHED`) |
| loadLineItems | `LineItemGraphRepository` | Neo4j line items | — |
| loadRules | `RulesService` | Neo4j `:Rule` | `RULED_BY` tracking |
| loadRegistry | `CanonicalRegistryRepository` | Neo4j canonicals + tiers | — |
| adjudicate | `LineItemMatcher` | lines + registry + rules | — (LLM verdict) |
| persistMatches | `LineItemGraphRepository` | verdict | `matchKind`, `BILLED_AS`/`REFERENCES`, `pipeline_logs`, `pipeline_reasoning` |
| loadRateCard | `ServiceGraphRepository` | Neo4j services for matched canonicals | — |
| resolveSymbols | `SymbolResolver` | rate-card cluster + guidance | — (LLM) |
| composeReferencedExpressions | `ReferencedExpressionComposer` | referenced services' cluster + `PRICED_FROM` relations | — (LLM, gated) |
| resolveSiblingSymbols | `SiblingSymbolResolver` | referenced siblings' billed amounts | — (LLM) |
| persistResolved | `LineItemGraphRepository` | resolved symbols | Neo4j `symbols`, `pipeline_logs` |
| reconcileAmounts | `AmountReconciler` | formula + symbols vs billed | — (pure) |
| persistReconciliation | `LineItemGraphRepository` | verdicts | Neo4j `status`, amounts, `pipeline_logs` |

## The three match kinds

The adjudicator (`LineItemMatcher`, Haiku) validates the extraction-time guess and settles the
final `matchKind` for each line:

- **service_match** — the line bills a registry canonical. Writes a `BILLED_AS` edge to that
  `CanonicalService`; the resolve phase later fills its `rate` from the rate card.
- **sibling_ref** — the amount is computed from OTHER lines in the same invoice (e.g. an admin
  fee that is a % of other rows). Writes `REFERENCES` edges to those sibling line ids; the
  *sibling* resolver fills its symbols from the referenced lines' billed amounts.
- **unmatched** — no confident canonical and not a sibling. No rate-card rate; reconciled
  straight to `needs_review` unless guidance/rules price it.

Identity is by **meaning**, disambiguated by **rate** (a gross rate mismatch is evidence of the
wrong service; a modest delta is the over/undercharge this reconciliation exists to surface).
The full adjudication rules are the `transaction.line-item.match` prompt in
[match-schema.ts](../schemas/match-schema.ts).

## Symbol resolution & the guidance override

`SymbolResolver` ([symbol-resolver.ts](../matching/symbol-resolver.ts)) fills each null symbol —
principally `rate` — reading, in precedence order:

1. the line's **`reviewerGuidance`** (a human correction), then
2. the vendor **rules** block, then
3. the matched tier in the **rate card** — the reserved `rate` is the tier's unit-price
   attribute (commonly keyed `price`), or its `pricingContext` text.

Two behaviours worth knowing:

- **Guidance/rules can price an unmatched line.** A line with no `BILLED_AS` match is still sent
  to the resolver when its guidance or a vendor rule states the price — so a reviewer can resolve
  a line the rate card doesn't cover.
- **Guidance can override a non-null symbol.** Every other source is fill-null-only, but a
  reviewer's guidance may correct a value that already exists (`mergeResolvedSymbols`,
  `sourcePath === 'guidance'`); the override is recorded in the audit log.

The rate-card cluster the resolver reads is rendered by `renderRateCardCluster`
([line-item-schema.ts](../schemas/line-item-schema.ts)), which strips the `Attributes` node's
internal plumbing keys (`serviceId`/`tenantId`/`attributeSet`) so only real rate attributes
reach the model.

## Cross-service pricing references (composed expressions)

Some rate-card services are priced *relative to another* — "B = 40% of A", where "A = 1% of
total value". A single tier carries no resolvable `rate` for such a line, so a dedicated phase
composes it. The reference is captured once, at commit time, by `ServiceReferenceDetector` (see
[../../source/commit/commit-services.flow.ts](../../source/commit/commit-services.flow.ts)),
which writes a `PRICED_FROM` edge from the referencing `Service` to the `CanonicalService` its
price derives from, carrying the verbatim relationship wording.

At match time this is gated and cheap:

- **loadRateCard** follows `PRICED_FROM` (one BFS level at a time, cycle-guarded, depth-capped)
  so the referenced services' clusters load alongside the billed one.
- **composeReferencedExpressions** (`ReferencedExpressionComposer`) runs ONLY when a matched
  service starts a reference chain. For those lines the model **rewrites the `formula`** to
  encode the relationship — multiplicative (`base * pctA * pctB`), additive (`base * pctA +
  flat`), or mixed — and sources each symbol: the base/"total value" from the line's own
  attributes, the percentages from the referenced services' `pricingContext`. It emits the
  *symbolic* expression only; well-formedness is checked with the same `validateExpression`
  matching uses, and the arithmetic stays deterministic (evaluated in reconciliation). The
  composed row REPLACES the rate-card row for that line, concatenating the audit logs.

Fail-soft throughout: a chain the model can't express (null/invalid formula), a dangling
reference, or a still-null base leaves the line `needs_review` — never a guessed number.

## Reconciliation (deterministic)

`AmountReconciler` ([amount-reconciler.ts](../matching/amount-reconciler.ts)) evaluates each
resolved line's `formula` over its `symbols` to an expected amount and compares it to the billed
amount within tolerance (1¢ floor / 0.5% relative), writing a `status` of `match` / `mismatch` /
`needs_review`. A line with an unresolved symbol or no formula lands `needs_review` with a note
naming what's missing — the reviewer supplies it and the line reruns.

## Statuses, async matching, and single-line rerun

- **Document statuses.** A committed doc is `COMMITTED`; kicking off a match flips it to
  `MATCHING`; completion → `MATCHED`. The bare loader is identity+type only, so the match flow's
  own `COMMITTED | MATCHING | MATCHED` gate governs — a background (async) match on a `MATCHING`
  doc and a re-match of a `MATCHED` doc both pass.
- **Async matching.** With `TRANSACTION_MATCH_ASYNC=true`, the request flips the doc to
  `MATCHING` and enqueues; `MatchProcessor` runs `matchFlow.run` on the worker.
- **Single-line rerun.** `runForLine` re-runs only a targeted line (after a reviewer submits
  guidance). Every phase operates on the targeted subset (`scopeToTargets`), so only that line's
  graph state is rewritten; all lines are still *loaded* so a targeted sibling_ref can resolve
  its references against the section.

## Key files

- [match-line-items.flow.ts](../matching/match-line-items.flow.ts) — the phase composition (`run` / `runForLine`)
- [line-item-matcher.ts](../matching/line-item-matcher.ts) + [match-schema.ts](../schemas/match-schema.ts) — adjudication
- [symbol-resolver.ts](../matching/symbol-resolver.ts) + [resolve-schema.ts](../schemas/resolve-schema.ts) — rate-card resolution
- [referenced-expression-composer.ts](../matching/referenced-expression-composer.ts) + [referenced-compose-schema.ts](../schemas/referenced-compose-schema.ts) — cross-service (`PRICED_FROM`) expression composition
- [sibling-symbol-resolver.ts](../matching/sibling-symbol-resolver.ts) — sibling-derived resolution
- [amount-reconciler.ts](../matching/amount-reconciler.ts) — the deterministic verdict
- [../../infra/graph/docs/graph-model.md](../../infra/graph/docs/graph-model.md) — the `LineItem`/`BILLED_AS`/`REFERENCES` graph
