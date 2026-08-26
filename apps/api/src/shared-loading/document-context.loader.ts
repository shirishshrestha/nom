import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentEntity, DocumentEntity, FileEntity } from '@nom/database';
import { DOCUMENT_STATUSES } from '@nom/shared';
import { AttributeSetRegistry, type AttributeSet } from '../attribute-set';

export interface SourceContext {
  document: DocumentEntity;
  set: AttributeSet;
  sections: ContentEntity[]; // ordered by position ASC
  file: FileEntity | null;
}

// Shared loader for the document + content + file triple, with the status /
// attribute-set gating that source extraction requires. Replaces the duplicated
// load-and-gate logic that lived inside SourceService (and parts of DocumentsService).
@Injectable()
export class DocumentContextLoader {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documents: Repository<DocumentEntity>,
    @InjectRepository(ContentEntity)
    private readonly content: Repository<ContentEntity>,
    @InjectRepository(FileEntity)
    private readonly files: Repository<FileEntity>,
    private readonly registry: AttributeSetRegistry,
  ) {}

  // Org-scoped fetch; throws NotFound when absent.
  async requireDocument(
    organizationId: string,
    id: string,
  ): Promise<DocumentEntity> {
    const document = await this.documents.findOneBy({ id, organizationId });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  // A validated/committed *source* document + its resolved attribute set.
  async loadSourceDoc(
    organizationId: string,
    id: string,
  ): Promise<{ document: DocumentEntity; set: AttributeSet }> {
    const document = await this.requireDocument(organizationId, id);

    // Validated onward — STAGED (already has a staged snapshot, re-extracting) and
    // COMMITTED are both past the validation gate. Re-extract of a COMMITTED doc is
    // blocked separately in SourceService.extractServices.
    const allowed: string[] = [
      DOCUMENT_STATUSES.VALIDATED,
      DOCUMENT_STATUSES.STAGED,
      DOCUMENT_STATUSES.COMMITTED,
    ];
    if (!allowed.includes(document.status))
      throw new BadRequestException(
        'Document must be validated before extracting services.',
      );

    const set = this.registry.get(document.attributeSet);
    if (!set || set.documentType !== 'source')
      throw new BadRequestException(
        `Document is not a source document (attributeSet=${document.attributeSet ?? 'none'})`,
      );

    return { document, set };
  }

  // Full extraction context: the gated source doc plus ordered content sections
  // and the originating file.
  async loadSourceContext(
    organizationId: string,
    id: string,
  ): Promise<SourceContext> {
    const { document, set } = await this.loadSourceDoc(organizationId, id);
    return this.withContent(organizationId, document, set);
  }

  // A *transaction* document + its resolved set. Existence + documentType only — the
  // status policy is the caller's concern (extraction gates in loadTransactionContext,
  // matching gates in TransactionMatchFlow), since a MATCHING/MATCHED doc is loadable for
  // a (re)match but not for extraction.
  async loadTransactionDoc(
    organizationId: string,
    id: string,
  ): Promise<{ document: DocumentEntity; set: AttributeSet }> {
    const document = await this.requireDocument(organizationId, id);

    const set = this.registry.get(document.attributeSet);
    if (!set || set.documentType !== 'transaction')
      throw new BadRequestException(
        `Document is not a transaction document (attributeSet=${document.attributeSet ?? 'none'})`,
      );

    return { document, set };
  }

  async loadTransactionContext(
    organizationId: string,
    id: string,
  ): Promise<SourceContext> {
    const { document, set } = await this.loadTransactionDoc(organizationId, id);
    // Extraction-only status gate — a MATCHING/MATCHED doc must not be re-extracted.
    const allowed: string[] = [
      DOCUMENT_STATUSES.VALIDATED,
      DOCUMENT_STATUSES.PROCESSING,
      DOCUMENT_STATUSES.COMMITTED,
    ];
    if (!allowed.includes(document.status))
      throw new BadRequestException(
        'Document must be validated before extracting line items.',
      );
    return this.withContent(organizationId, document, set);
  }

  // The document's ordered content sections + originating file.
  private async withContent(
    organizationId: string,
    document: DocumentEntity,
    set: AttributeSet,
  ): Promise<SourceContext> {
    const [sections, file] = await Promise.all([
      this.content.find({
        where: { documentId: document.id, organizationId },
        order: { position: 'ASC' },
      }),
      this.files.findOneBy({ id: document.fileId, organizationId }),
    ]);
    return { document, set, sections, file };
  }
}
