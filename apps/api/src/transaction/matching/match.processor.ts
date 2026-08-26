import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { DocumentEntity } from '@nom/database';
import { DOCUMENT_STATUSES } from '@nom/shared';
import { TransactionMatchFlow } from './match-line-items.flow';

export const MATCH_QUEUE = 'transaction-match';

export interface MatchJobData {
  organizationId: string;
  documentId: string;
}

// Background consumer for line-item matching. The producer (TransactionService) has
// already flipped the doc to MATCHING; on success we flip to MATCHED, on failure back
// to COMMITTED so it stays re-matchable. Rethrow so BullMQ records the job as failed.
@Processor(MATCH_QUEUE)
export class MatchProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchProcessor.name);

  constructor(
    private readonly matchFlow: TransactionMatchFlow,
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
  ) {
    super();
  }

  async process(job: Job<MatchJobData>): Promise<void> {
    const { organizationId, documentId } = job.data;
    try {
      await this.matchFlow.run(organizationId, documentId);
      await this.documentsRepo.update(
        { id: documentId, organizationId },
        { status: DOCUMENT_STATUSES.MATCHED },
      );
      this.logger.log(`matched doc=${documentId}`);
    } catch (e) {
      await this.documentsRepo.update(
        { id: documentId, organizationId },
        { status: DOCUMENT_STATUSES.COMMITTED },
      );
      this.logger.warn(
        `match job failed doc=${documentId}: ${(e as Error).message}`,
      );
      throw e;
    }
  }
}
