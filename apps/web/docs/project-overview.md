# Overview

## Overview

The web app is the reviewer-facing front end of an accounts-payable (AP)
automation platform. Its purpose is to take the manual, error-prone work of
checking vendor bills against what was agreed and turn it into a fast,
auditable review.

The problem it solves: vendors send invoices that are supposed to match a
previously agreed quotation (the rate card), but in practice they drift —
wrong rates, quantities, tiers, or extra charges. Catching those discrepancies
by hand across many line items is slow and easy to get wrong.

How it works, end to end:

1. A user uploads a vendor **quotation**; the backend extracts it into a
   structured **rate card** of agreed services, tiers, and prices.
2. Later, the user uploads that vendor's **invoice**. The backend extracts its
   line items and **reconciles** each one against the rate card — computing the
   expected amount, comparing it to what was charged, and flagging the
   difference.
3. The web app presents the result: every line shows its matched quotation
   line, the expected-vs-charged breakdown, the formula behind the expected
   amount, and the match model's reasoning.
4. A human **reviewer** works the list — inspecting each line and, for a
   mismatch, either accepting the discrepancy as-is (the prior status is kept
   server-side for audit) or leaving a **guidance** note that the matcher
   re-applies on later runs.

The platform is split across two applications that divide the work. The
document-processing service (`apps/api`) runs extraction, matching, and
reconciliation; the web app owns everything the reviewer touches — the upload
and review workflow, the state that ties a document's steps together, and the
interface where discrepancies are judged and accepted.

## Goals

1. Let authenticated users manage vendors, quotations, and invoices.
2. Upload invoice/quotation documents and drive them through the backend
   processing pipeline.
3. Present extracted line items reconciled against quotation rate cards.
4. Let a reviewer inspect each line's expected-vs-charged breakdown, accept
   discrepancies, and leave guidance the matcher re-applies on later runs.
5. Surface review status and per-document progress at a glance.

## Core User Flow (invoices)

1. User signs in (better-auth session; guarded by the `_app` layout).
2. User picks a vendor and uploads one or more invoice files (`/invoice/add`).
   The vendor is required — it scopes the rate card the lines reconcile against.
3. The app drives the upload pipeline against the API:
   `confirm-many → extract-metadata → validate → extract-line-items`. Two gates
   can interrupt it: files the API rejects (surfaced in an invalid-files dialog,
   which halts the run) and files that validate with warnings (the reviewer
   continues or discards).
4. The invoice list (`/invoice`) shows each document's review status
   (Pending / Completed), with vendor, date-range and status filters.
5. The reviewer opens the documents (`/invoice/review` — a batch page, taking a
   vendor and one or more document ids). Matching fires here, on arrival, and
   may run synchronously or be queued and polled via `match-status`.
6. Each line item shows its status (Matched / Mismatch / Issue / Accepted), the
   matched quotation line, expected vs charged, the formula behind the expected
   amount, and the match model's reasoning. An attention banner counts the lines
   that need a decision.
7. For a mismatch the reviewer accepts the discrepancy as-is, or saves a
   guidance note on the line — a persistent correction the matcher re-applies on
   every rerun.
8. "Complete" confirms, then marks every document in the batch reviewed
   (`mark-reviewed`) and returns to the list, where they now read Completed.

The quotation flow is parallel: upload → extract → rules review, feeding the
rate cards that invoices later reconcile against.

## Features

### Auth

- Email/password sign-in, sign-up, forgot/reset password (better-auth).
- Session guard on all `_app` routes; a 401 mid-session opens a
  session-expired dialog rather than a hard redirect.

### Vendors

- CRUD for the vendor registry: list, add, edit, delete, view.
- Vendors are the owner of quotations and invoices.

### Quotations

- Upload and extract quotation documents into rate cards.
- Rules review over the extracted structure.

### Rules

- Per-vendor rules (`/vendor/$vendorId/rules`) that steer a pipeline phase —
  service extraction, line-item extraction, service grouping, or matching and
  reconciliation.
- Searchable list with inline add/edit and delete confirmation.

### Invoices

- Upload invoice documents and run the confirm/extract/validate pipeline;
  matching runs on the review page.
- List with vendor, date-range and status filters, and review status.
- Line-item review: reconciliation (expected · charged · difference),
  the matched quotation line, the how-determined formula breakdown, and
  match reasoning.
- Accept line-item discrepancies; save per-line guidance for future runs.
- Complete a review, marking every document in the batch reviewed.

### Dashboard

- Stats overview and an invoice-intake entry point.

## Scope

### In scope

- Reviewer UI for vendors, quotations, and invoices.
- Driving the backend document pipeline over HTTP.
- Rendering extraction/match/reconciliation output for human review.
- Discrepancy acceptance and per-line guidance.

## Where things live

- Product/domain flow (this doc) → `apps/web/docs/`
- Per-feature flow + surfaces → `apps/web/docs/features/` (`vendor.md` — incl. rules,
  `quotation.md`, `invoice.md`)
- Web technical architecture → `apps/web/docs/architecture.md`
- Backend domain (extraction, matching, reconciliation) → `apps/api/docs/`
