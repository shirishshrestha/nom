import { In } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import type { DocumentEntity } from '@nom/database';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@nom/shared';
import type { DocumentStatus, StagedService } from '@nom/shared';

/**
 * Collapse lines sharing the graph supersession key (canonicalName, tierSlug):
 * after canonical reconciliation these are the same priced line by the system's
 * own identity model, and the graph has no key to keep them apart (they'd land as
 * concurrent current=true rows on one canonical). Keeps the LAST occurrence
 * (most-recently reviewed) and appends a merge note to its log. Flat lines
 * (tierSlug null) key on '' so they collapse too.
 */
export const dedupeByBand = (services: StagedService[]): StagedService[] => {
  const byKey = new Map<string, StagedService>();
  for (const s of services) {
    const key = `${s.canonicalName} ${s.tierSlug ?? ''}`;
    const prev = byKey.get(key);
    byKey.set(
      key,
      prev ? { ...s, log: `${s.log}\n· merged duplicate of ${prev.id}` } : s,
    );
  }
  return [...byKey.values()];
};

/**
 * Source docs for an org (optionally scoped to one vendor), filtered to a caller-chosen
 * set of statuses. Default is all pre-commit states (EXTRACTED/VALIDATED/STAGED) — used by
 * discardUncommittedForVendor. The feed reads pass [STAGED] only; the stage-time sweep
 * passes [EXTRACTED, VALIDATED].
 */
export const uncommittedSourceDocsWhere = (
  organizationId: string,
  vendorId?: string,
  statuses: DocumentStatus[] = [
    DOCUMENT_STATUSES.EXTRACTED,
    DOCUMENT_STATUSES.VALIDATED,
    DOCUMENT_STATUSES.STAGED,
  ],
): FindOptionsWhere<DocumentEntity> => ({
  organizationId,
  ...(vendorId ? { vendorId } : {}),
  documentType: DOCUMENT_TYPES.SOURCE,
  status: In(statuses),
});
