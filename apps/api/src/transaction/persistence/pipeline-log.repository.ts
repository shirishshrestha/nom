import { Injectable, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PipelineLogEntity } from '@nom/database';
import type { ObservabilityEntityType } from '@nom/shared';
import { stripNuls } from '../../common/text';

export interface PipelineLogAppendInput {
  organizationId: string;
  documentId: string;
  entries: Array<{ entityId: string; messages: string[] }>;
}

// Append-only audit trail for a pipeline entity (relocated off the graph). Best-effort
// by contract: the graph verdicts are the source of truth, so a write error is
// warn-logged and swallowed — an observability write never fails the flow. Each
// instance is bound to one entity type at construction (see transaction.module.ts),
// so every read/write is scoped to its own pipeline by construction.
@Injectable()
export class PipelineLogRepository {
  private readonly logger = new Logger(PipelineLogRepository.name);

  constructor(
    private readonly repo: Repository<PipelineLogEntity>,
    private readonly entityType: ObservabilityEntityType,
  ) {}

  async append(input: PipelineLogAppendInput): Promise<void> {
    const rows = input.entries
      .filter((e) => e.messages.length > 0)
      .map((e) => ({
        organizationId: input.organizationId,
        entityType: this.entityType,
        entityId: e.entityId,
        documentId: input.documentId,
        messages: stripNuls(e.messages),
      }));
    if (rows.length === 0) return;
    try {
      await this.repo.insert(rows);
    } catch (err) {
      this.logger.warn(
        `pipeline log append failed doc=${input.documentId} (${rows.length} row(s)): ${String(err)}`,
      );
    }
  }

  /** On-demand single-entity read — the full trail in append order. */
  async listForEntity(
    organizationId: string,
    entityId: string,
  ): Promise<string[]> {
    const rows = await this.repo.find({
      where: { organizationId, entityType: this.entityType, entityId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.flatMap((r) => r.messages);
  }
}
