import { Column, Entity, Index } from 'typeorm';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';

// Append-only capture of every LLM call's input + output, for assembling a
// fine-tuning dataset later. One row per extract() invocation. sourceType/sourceId
// are a generic pointer to the entity a call was performed for (a file, content
// chunk, or document); nullable so an un-threaded call site skips the write rather
// than write a non-tenant-compliant row. deletedAt from the mixin is unused.
@Index(['organizationId', 'createdAt'])
@Index(['organizationId', 'sourceType', 'sourceId'])
@Entity('llm_call_logs')
export class LlmCallLogEntity extends OrganizationScopedEntity {
  @Column({ type: 'text' })
  promptId!: string;

  @Column({ type: 'text' })
  promptVersion!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'text', nullable: true })
  sourceType!: string | null;

  @Column({ type: 'text', nullable: true })
  sourceId!: string | null;

  @Column({ type: 'text' })
  systemPrompt!: string;

  @Column({ type: 'jsonb' })
  humanPrompt!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  output!: unknown;

  @Column({ type: 'boolean' })
  succeeded!: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'int' })
  durationMs!: number;

  // When the LLM call was made (call-start), distinct from createdAt (row-insert time).
  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  // Token usage + resolved model id, read from the provider response. Nullable: a
  // provider/response that omits usage_metadata skips them rather than writing 0.
  @Column({ type: 'int', nullable: true })
  inputTokens!: number | null;

  @Column({ type: 'int', nullable: true })
  outputTokens!: number | null;

  @Column({ type: 'text', nullable: true })
  model!: string | null;
}
