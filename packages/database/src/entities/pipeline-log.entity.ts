import { Column, Entity, Index } from 'typeorm';
import type { ObservabilityEntityType } from '@nom/shared';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';

// Append-only audit trail relocated off Neo4j :LineItem nodes. One row per phase
// append-batch per entity (the graph used to rewrite a growing list every phase).
// Keyed by (entityType, entityId) so every pipeline shares the store — see
// OBSERVABILITY_ENTITY_TYPES for the scoping contract. deletedAt from the mixin is unused.
@Index(['organizationId', 'documentId'])
@Index(['organizationId', 'entityType', 'entityId'])
@Entity('pipeline_logs')
export class PipelineLogEntity extends OrganizationScopedEntity {
  @Column({ type: 'text' })
  entityType!: ObservabilityEntityType;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @Column({ type: 'jsonb' })
  messages!: string[];
}
