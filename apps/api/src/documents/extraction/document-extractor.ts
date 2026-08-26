import { Inject, Injectable } from '@nestjs/common';
import pLimit from 'p-limit';
import { FileEntity } from '@nom/database';
import type { DocumentMetadata } from '@nom/shared';
import { STRUCTURED_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type {
  ExtractionRequest,
  StructuredExtractor,
} from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { DocumentTooLargeError } from '../../infra/llm/llm-error';
import { S3Service } from '../../files/s3.service';
import { renderRulesBlock } from '../../common/registry-render';
import { EXTRACTION_PROMPT } from '../attribute-sets';
import { ExtractionSchema, type ExtractionResult } from '../schemas';

export interface ExtractedDocument {
  metadata: DocumentMetadata;
  sections: { label: string; text: string; page: number | null }[];
}

// Per-file result of a batch extraction: the extracted document, or a failure
// isolated so one bad/oversized file never sinks the rest of the batch.
export type ExtractOutcome =
  | { ok: true; file: FileEntity; document: ExtractedDocument }
  | { ok: false; file: FileEntity; error: string };

// Raw-byte ceiling for a single-shot extraction. Above this the PDF is rejected
// pre-flight (before spending an LLM call). ~15 MB default; env-tunable.
const MAX_DOC_BYTES = Number(process.env.MAX_DOC_BYTES ?? 15 * 1024 * 1024);

// Runs the multimodal extraction for raw files: fetch bytes from S3, prompt the
// structured extractor, and drop summary/recap sections (never persisted).
@Injectable()
export class DocumentExtractor {
  constructor(
    @Inject(STRUCTURED_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
    private readonly s3: S3Service,
  ) {}

  async extract(file: FileEntity, rules?: string): Promise<ExtractedDocument> {
    const bytes = await this.s3.getObjectBytes(file.storageKey);
    if (bytes.length > MAX_DOC_BYTES)
      throw new DocumentTooLargeError(
        `document ${(bytes.length / 1024 / 1024).toFixed(1)}MB exceeds the ${(MAX_DOC_BYTES / 1024 / 1024).toFixed(0)}MB single-extraction limit`,
      );
    const result = await this.extractor.extract(
      this.buildRequest(file, bytes, rules),
    );
    return this.toExtracted(result);
  }

  // Bounded fan-out over many files: each file's bytes are fetched and extracted in
  // one concurrency-capped task (base64 inflates ~1.33x and is held resident, so an
  // unbounded fan-out over many large PDFs can OOM). Failures are isolated per-file —
  // one bad/oversized file yields an { ok: false } outcome, not a rejected batch.
  // Order-preserving — result[i] corresponds to files[i]. Vendor rules are resolved per
  // file (vendor-scoped, and a batch may mix vendors/types), keyed by file id.
  async extractMany(
    files: FileEntity[],
    rulesByFile?: Map<string, string | undefined>,
  ): Promise<ExtractOutcome[]> {
    const limit = pLimit(Number(process.env.LLM_MAX_CONCURRENCY ?? 4));
    return Promise.all(
      files.map((file) =>
        limit(async (): Promise<ExtractOutcome> => {
          try {
            return {
              ok: true,
              file,
              document: await this.extract(file, rulesByFile?.get(file.id)),
            };
          } catch (e) {
            return { ok: false, file, error: (e as Error).message };
          }
        }),
      ),
    );
  }

  // Prompt is type-specific; the type comes from the file itself (set at upload).
  private buildRequest(
    file: FileEntity,
    bytes: Buffer,
    rules?: string,
  ): ExtractionRequest<ExtractionResult> {
    return {
      system: `${EXTRACTION_PROMPT.render(file.documentType)}${renderRulesBlock(rules)}`,
      human: [
        {
          type: 'text',
          text: 'Extract metadata and sections from this document.',
        },
        {
          type: 'media',
          mimeType: file.mimeType || 'application/pdf',
          dataBase64: bytes.toString('base64'),
        },
      ],
      schema: ExtractionSchema,
      options: {
        operation: promptTag(EXTRACTION_PROMPT),
        reference: {
          organizationId: file.organizationId,
          sourceType: 'file',
          sourceId: file.id,
        },
      },
    };
  }

  private toExtracted(result: ExtractionResult): ExtractedDocument {
    // The classification scratch is CoT context for the model, never persisted.
    const metadata: DocumentMetadata = { ...result.metadata };
    delete (metadata as { classificationBasis?: string }).classificationBasis;
    return {
      metadata,
      sections: result.sections
        .filter((s) => !s.isSummary)
        .map((s) => ({ label: s.label, text: s.text, page: s.page })),
    };
  }
}
