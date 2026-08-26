import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentEntity } from '@nom/database';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@nom/shared';
import type { DocumentType } from '@nom/shared';
import type { OrgSession } from '../auth/auth.types.js';
import { DOCUMENT_GRAPH_LABELS } from '../infra/graph/graph-labels';
import { DocumentGraphRepository } from '../infra/graph/document-graph.repository';
import { GraphWriteError } from '../infra/graph/graph-error';
import { VendorMatcher } from './validation/vendor-matcher';
import { isValidFinancialDocument } from './validation';
import { DocumentRepository } from './persistence/document.repository';
import { buildDocumentContext } from './helpers/utils';

// User-facing name for each document type — reject messages speak the product's
// language ("quotation" / "invoice"), never the internal type keys.
const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  source: 'quotation',
  transaction: 'invoice',
};

// Validate flow: financial hard-gate + type / attributeSet / date soft-rejects,
// AI vendor-match (warn), then mirror onto the graph on success. Re-runnable.
@Injectable()
export class DocumentValidationFlow {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    private readonly vendorMatcher: VendorMatcher,
    private readonly documentGraph: DocumentGraphRepository,
    private readonly documentRepo: DocumentRepository,
  ) {}

  private readonly log = new Logger(DocumentValidationFlow.name);

  async validate(session: OrgSession, id: string, documentType: DocumentType) {
    const organizationId = session.session.activeOrganizationId;
    const document = await this.documentsRepo.findOneBy({ id, organizationId });
    if (!document) throw new NotFoundException('Document not found');

    if (document.status === DOCUMENT_STATUSES.COMMITTED)
      throw new BadRequestException('Document is already committed');

    this.log.log(`validate start doc=${id} type=${documentType}`);
    const metadata = document.metadata;
    const label = DOCUMENT_TYPE_LABEL[documentType];

    if (!isValidFinancialDocument(metadata, documentType)) {
      const rejectReason = `This document doesn't look like a valid ${label}.`;
      await this.documentsRepo.update(id, {
        status: DOCUMENT_STATUSES.REJECTED,
        rejectReason,
      });
      this.log.warn(
        `rejected doc=${id}: isFinancial=${metadata.isFinancial}, attributeSet=${metadata.attributeSet ?? 'none'}`,
      );
      return {
        id,
        status: DOCUMENT_STATUSES.REJECTED,
        warnings: [],
        metadata,
        rejectReason,
      };
    }

    if (metadata.typeMismatch) {
      const rejectReason = `This document doesn't look like the ${label} it was uploaded as.`;
      await this.documentsRepo.update(id, {
        status: DOCUMENT_STATUSES.REJECTED,
        rejectReason,
      });
      this.log.warn(
        `rejected doc=${id}: typeMismatchReason=${metadata.typeMismatchReason ?? 'none'}`,
      );
      return {
        id,
        status: DOCUMENT_STATUSES.REJECTED,
        warnings: [],
        metadata,
        rejectReason,
      };
    }

    if (document.vendorId) {
      const priorMeta = await this.documentRepo.findOldestDocumentForVendor({
        vendorId: document.vendorId,
        documentType,
        excludeId: id,
      });
      const existingAttributeSet = priorMeta?.attributeSet ?? null;

      if (
        existingAttributeSet &&
        existingAttributeSet !== metadata.attributeSet
      ) {
        const rejectReason = `This ${label}'s format doesn't match the other ${label}s already uploaded for this vendor. They must all use the same format.`;
        await this.documentsRepo.update(id, {
          status: DOCUMENT_STATUSES.REJECTED,
          rejectReason,
        });
        this.log.warn(
          `rejected doc=${id}: attributeSet mismatch new=${metadata.attributeSet} existing=${existingAttributeSet}`,
        );
        return {
          id,
          status: DOCUMENT_STATUSES.REJECTED,
          warnings: [],
          metadata,
          rejectReason,
        };
      }

      if (documentType === DOCUMENT_TYPES.SOURCE && document.effectiveFrom) {
        const latest = await this.documentRepo.findLatestDocumentForVendor({
          vendorId: document.vendorId,
          documentType,
          excludeId: id,
        });
        if (
          latest?.effectiveFrom &&
          document.effectiveFrom < latest.effectiveFrom
        ) {
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          const rejectReason = `Cannot upload this ${label} dated ${fmt(document.effectiveFrom)} because a newer ${label} dated ${fmt(latest.effectiveFrom)} already exists for this vendor.`;
          await this.documentsRepo.update(id, {
            status: DOCUMENT_STATUSES.REJECTED,
            rejectReason,
          });
          this.log.warn(
            `rejected doc=${id}: outdated vs latest ${fmt(latest.effectiveFrom)}`,
          );
          return {
            id,
            status: DOCUMENT_STATUSES.REJECTED,
            warnings: [],
            metadata,
            rejectReason,
          };
        }
      }
    }

    const vendorMatch = await this.vendorMatcher.match(
      organizationId,
      document,
      metadata,
    );
    const warnings =
      vendorMatch && !vendorMatch.isMatch ? [vendorMatch.reason] : [];

    if (vendorMatch) metadata.validation = { vendorMatch };

    await this.documentsRepo.update(id, {
      status: DOCUMENT_STATUSES.VALIDATED,
      metadata,
      warnings,
      rejectReason: undefined,
    });
    await this.writeGraph(organizationId, document);

    this.log.log(
      `validated doc=${id} vendor=${document.vendorId ?? 'none'} warnings=${warnings.length}`,
    );
    return { id, status: DOCUMENT_STATUSES.VALIDATED, warnings, metadata };
  }

  // Mirror the join key + reasoning fields onto the graph (metadata stays in
  // Postgres). Non-fatal: a failed mirror is logged, never fails validation.
  private async writeGraph(organizationId: string, document: DocumentEntity) {
    const label = DOCUMENT_GRAPH_LABELS[document.documentType];
    if (!label || !document.vendorId) return;

    try {
      await this.documentGraph.upsertDocument({
        documentId: document.id,
        tenantId: organizationId,
        vendorId: document.vendorId,
        label,
        attributeSet: document.attributeSet ?? null,
        documentKind: document.metadata.documentKind ?? null,
        currency: document.metadata.currency ?? null,
        referenceNumbers: document.metadata.referenceNumbers ?? [],
        context: buildDocumentContext(document.metadata),
        effectiveFrom: document.effectiveFrom?.toISOString() ?? null,
        effectiveTo: document.effectiveTo?.toISOString() ?? null,
      });
    } catch (e) {
      if (e instanceof GraphWriteError)
        this.log.warn(`${e.message} — ${(e.cause as Error)?.message ?? ''}`);
      else throw e;
    }
  }
}
