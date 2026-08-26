// Which pipeline an observability row (log / reasoning) belongs to. The pipeline_logs
// and pipeline_reasoning tables are keyed by (entityType, entityId) so every pipeline
// feeds the same store. Scoping is structural: each repository instance is bound to
// one entity type at construction (see transaction.module.ts), so a query never spans
// pipelines. Only LINE_ITEM writes today; SERVICE is reserved for the source pipeline.
export const OBSERVABILITY_ENTITY_TYPES = {
  LINE_ITEM: 'line_item',
  SERVICE: 'service',
} as const;

export type ObservabilityEntityType =
  (typeof OBSERVABILITY_ENTITY_TYPES)[keyof typeof OBSERVABILITY_ENTITY_TYPES];
