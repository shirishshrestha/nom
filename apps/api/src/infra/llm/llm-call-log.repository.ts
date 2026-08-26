import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmCallLogEntity } from '@nom/database';

// One row per LLM call, captured for fine-tuning data prep. Append-only.
export interface LlmCallLogInput {
  organizationId: string;
  sourceType: string;
  sourceId: string;
  promptId: string;
  promptVersion: string;
  provider: string;
  systemPrompt: string;
  humanPrompt: unknown;
  output: unknown;
  succeeded: boolean;
  errorMessage: string | null;
  durationMs: number;
  occurredAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
}

@Injectable()
export class LlmCallLogRepository {
  constructor(
    @InjectRepository(LlmCallLogEntity)
    private readonly repo: Repository<LlmCallLogEntity>,
  ) {}

  async record(input: LlmCallLogInput): Promise<void> {
    // save() (not insert()) so the `unknown` jsonb fields fit DeepPartial; append-only,
    // input carries no id, so this is always an insert.
    await this.repo.save(input);
  }
}
