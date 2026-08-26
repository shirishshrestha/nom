import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentEntity, VendorEntity } from '@nom/database';
import type { DocumentMetadata, DocumentVendorMatch } from '@nom/shared';
import { STRUCTURED_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import {
  formatDocMeta,
  formatVendor,
  VENDOR_MATCH_TEMPLATE,
} from '../helpers/vendor-match';
import { VendorMatchSchema } from '../schemas';

// AI vendor-match: compares the extracted vendor name against the registered
// vendor record only (name/code/type/location/comments). Mismatch is a warning
// (never rejects). Deliberately does NOT consult prior documents: a warned doc
// would otherwise become naming precedent and flip a later mismatch to a match.
// Skipped (null) when there is no extracted vendorName or no linked vendorId.
@Injectable()
export class VendorMatcher {
  constructor(
    @Inject(STRUCTURED_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
    @InjectRepository(VendorEntity)
    private readonly vendorsRepo: Repository<VendorEntity>,
  ) {}

  async match(
    organizationId: string,
    document: DocumentEntity,
    metadata: DocumentMetadata,
  ): Promise<DocumentVendorMatch | null> {
    if (!metadata.vendorName || !document.vendorId) return null;

    const vendor = await this.vendorsRepo.findOneBy({
      id: document.vendorId,
      organizationId,
    });

    const { isMatch, reason } = await this.extractor.extract({
      system: VENDOR_MATCH_TEMPLATE.render(),
      human: `## Current document\n${formatDocMeta(metadata, document.documentType)}\n\n## Registered vendor\n${formatVendor(vendor)}`,
      schema: VendorMatchSchema,
      options: {
        operation: promptTag(VENDOR_MATCH_TEMPLATE),
        reference: {
          organizationId,
          sourceType: 'document',
          sourceId: document.id,
        },
      },
    });

    return { isMatch, reason };
  }
}
