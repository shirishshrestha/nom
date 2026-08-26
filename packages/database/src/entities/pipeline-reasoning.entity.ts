import { Column, Entity, Index, Unique } from 'typeorm';
import type { ObservabilityEntityType } from '@nom/shared';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';

// The match reasoning relocated off Neo4j :LineItem nodes. One row per entity, upserted
// each match run (reasoning was a JSON.stringify blob on the node — here it is native
// jsonb). Keyed by (entityType, entityId) — see OBSERVABILITY_ENTITY_TYPES for the
// scoping contract. Unique (org, entityType, entityId) is the upsert conflict target.
@Index(['organizationId', 'documentId'])
@Unique(['organizationId', 'entityType', 'entityId'])
@Entity('pipeline_reasoning')
export class PipelineReasoningEntity extends OrganizationScopedEntity {
  @Column({ type: 'text' })
  entityType!: ObservabilityEntityType;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @Column({ type: 'jsonb', nullable: true })
  reasoning!: Record<string, unknown> | null;
}
