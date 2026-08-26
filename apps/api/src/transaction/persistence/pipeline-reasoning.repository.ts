import { Injectable, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PipelineReasoningEntity } from '@nom/database';
import type { ObservabilityEntityType } from '@nom/shared';
import { stripNuls } from '../../common/text';

export interface PipelineReasoningRow {
  entityId: string;
  reasoning: Record<string, unknown> | null; // structured rationale (native jsonb)
}

export interface PipelineReasoningUpsertInput {
  organizationId: string;
  documentId: string;
  rows: PipelineReasoningRow[];
}

// One reasoning row per pipeline entity, upserted each match run (idempotent — a
// re-run overwrites rather than duplicates). Best-effort like PipelineLogRepository:
// the graph verdicts are the source of truth, so a write error is warn-logged and
// swallowed. Each instance is bound to one entity type at construction (see
// transaction.module.ts), so every read/write is scoped to its own pipeline.
@Injectable()
export class PipelineReasoningRepository {
  private readonly logger = new Logger(PipelineReasoningRepository.name);

  constructor(
    private readonly repo: Repository<PipelineReasoningEntity>,
    private readonly entityType: ObservabilityEntityType,
  ) {}

  async upsert(input: PipelineReasoningUpsertInput): Promise<void> {
    if (input.rows.length === 0) return;
    const rows = input.rows.map((r) => ({
      organizationId: input.organizationId,
      entityType: this.entityType,
      entityId: r.entityId,
      documentId: input.documentId,
      reasoning: stripNuls(r.reasoning),
    }));
    try {
      // Cast: TypeORM's QueryDeepPartialEntity recurses into the jsonb `reasoning`
      // (an arbitrary object) and rejects it — a known typing nuisance for jsonb columns.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await this.repo.upsert(rows as any, {
        conflictPaths: ['organizationId', 'entityType', 'entityId'],
      });
    } catch (err) {
      this.logger.warn(
        `pipeline reasoning upsert failed doc=${input.documentId} (${rows.length} row(s)): ${String(err)}`,
      );
    }
  }

  /** Bulk read: entityId → its reasoning, for one document. */
  async listForDocument(
    organizationId: string,
    documentId: string,
  ): Promise<Map<string, Record<string, unknown> | null>> {
    const rows = await this.repo.find({
      where: { organizationId, entityType: this.entityType, documentId },
    });
    return new Map(rows.map((r) => [r.entityId, r.reasoning]));
  }
}
