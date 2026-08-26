import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { DocumentEntity } from '@nom/database';
import type { ReviewService, StagedService, StagedStatus } from '@nom/shared';

export interface ServiceEdit {
  id: string;
  attributes?: Record<string, string | number | null>;
  title?: string;
  pricingContext?: string;
}

export interface OverlayResult {
  services: StagedService[];
}

// A same-document supersession pair for the graph: the edited service was re-issued
// under `newId`, replacing the committed node `priorId`.
export interface Amendment {
  priorId: string;
  newId: string;
}

export interface AmendmentResult {
  services: StagedService[];
  amendments: Amendment[];
}

// Strip internal canonical fields before a staged service reaches a reviewer.
export function toReview(s: StagedService): ReviewService {
  const rest = { ...s } as Partial<StagedService>;
  // delete rest.canonicalName;
  delete rest.canonicalDescription;
  delete rest.tierSlug; // internal band/amendment key — never shown to reviewers
  return rest as ReviewService;
}

// Compare concept fields ignoring case / surrounding + collapsed whitespace, so a
// cosmetic re-typing of the same title doesn't trigger a needless canonical re-match.
const normalize = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, ' ');

// Apply reviewer edits (attribute values + title/pricingContext) and removals onto the
// latest staged services: validates every edited/deleted id exists, appends an audit line
// per edited service, and drops deleted ids from the result. Throws BadRequest on an
// unknown id. Pure — does not persist.
// (saveServices re-verifies EVERY line's canonical regardless of what changed, so the
// overlay only needs to produce the merged services + audit log.)
export function overlayEdits(
  staged: StagedService[],
  edits: ServiceEdit[],
  deletedIds: string[],
  userId: string,
  version: number,
): OverlayResult {
  const editById = new Map(edits.map((e) => [e.id, e]));
  const deleted = new Set(deletedIds);
  const knownIds = new Set(staged.map((s) => s.id));
  for (const id of [...editById.keys(), ...deleted])
    if (!knownIds.has(id))
      throw new BadRequestException(`Unknown service id: ${id}`);

  const services = staged
    .filter((s) => !deleted.has(s.id))
    .map((s) => {
      const edit = editById.get(s.id);
      if (!edit) return s;

      const newAttrs = edit.attributes;
      const attrsChanged =
        !!newAttrs && JSON.stringify(newAttrs) !== JSON.stringify(s.attributes);
      const titleChanged =
        edit.title !== undefined &&
        normalize(edit.title) !== normalize(s.title);
      const pcChanged =
        edit.pricingContext !== undefined &&
        normalize(edit.pricingContext) !== normalize(s.pricingContext);

      const tags = [
        attrsChanged && 'attributes edited',
        titleChanged && 'title edited',
        pcChanged && 'pricingContext edited',
      ].filter(Boolean);

      return {
        ...s,
        attributes: newAttrs ?? s.attributes,
        title: edit.title ?? s.title,
        pricingContext: edit.pricingContext ?? s.pricingContext,
        log: `${s.log}\nsaved by ${userId} · v${version}${tags.length ? ` · ${tags.join(' · ')}` : ''}`,
      };
    });

  return { services };
}

// Apply reviewer edits to an ALREADY-COMMITTED snapshot as graph amendments. Same
// field merge as overlayEdits (attribute values + title/pricingContext), but a service
// whose merged content actually differs is re-issued under a NEW id — so the graph
// commits it as a new node — and the (priorId → newId) pair is recorded so the prior
// node can be retired + AMENDS-linked. Unchanged edits and untouched services keep
// their id and produce no amendment (no no-op graph churn). Throws BadRequest on an
// unknown edit id. Pure — does not persist. No deletions (out of scope for committed).
export function applyEditForAmendment(
  committed: StagedService[],
  edits: ServiceEdit[],
  userId: string,
  version: number,
): AmendmentResult {
  const editById = new Map(edits.map((e) => [e.id, e]));
  const knownIds = new Set(committed.map((s) => s.id));
  for (const id of editById.keys())
    if (!knownIds.has(id))
      throw new BadRequestException(`Unknown service id: ${id}`);

  const amendments: Amendment[] = [];
  const services = committed.map((s) => {
    const edit = editById.get(s.id);
    if (!edit) return s;

    const newAttrs = edit.attributes;
    const attrsChanged =
      !!newAttrs && JSON.stringify(newAttrs) !== JSON.stringify(s.attributes);
    const titleChanged =
      edit.title !== undefined && normalize(edit.title) !== normalize(s.title);
    const pcChanged =
      edit.pricingContext !== undefined &&
      normalize(edit.pricingContext) !== normalize(s.pricingContext);

    const tags = [
      attrsChanged && 'attributes edited',
      titleChanged && 'title edited',
      pcChanged && 'pricingContext edited',
    ].filter(Boolean);

    // A no-op edit changes nothing — keep the node as-is, no amendment.
    if (tags.length === 0) return s;

    const newId = randomUUID();
    amendments.push({ priorId: s.id, newId });
    return {
      ...s,
      id: newId,
      attributes: newAttrs ?? s.attributes,
      title: edit.title ?? s.title,
      pricingContext: edit.pricingContext ?? s.pricingContext,
      log: `${s.log}\namended by ${userId} · v${version} · ${tags.join(' · ')} · supersedes ${s.id}`,
    };
  });

  return { services, amendments };
}

// A not-yet-committed source doc + its latest staged snapshot (if any), shaped for
// the review editor. Shared by listUncommittedForVendor and
// findLatestUncommittedDocument, which differ only in which docs they fetch.
export function toUncommittedDocument(
  doc: DocumentEntity,
  stagedByDoc: Map<
    string,
    { id: string; services: StagedService[]; status: StagedStatus }
  >,
) {
  const staged = stagedByDoc.get(doc.id);
  return {
    documentId: doc.id,
    fileId: doc.fileId,
    fileName: doc.file?.name ?? '',
    status: doc.status,
    effectiveFrom: doc.effectiveFrom?.toISOString() ?? null,
    metadata: doc.metadata,
    services: staged?.services.map(toReview) ?? [],
    reviewStatus: staged?.status ?? null,
    // The staged row's own id — commit-all batches by this, not documentId.
    stagedId: staged?.id ?? null,
  };
}
