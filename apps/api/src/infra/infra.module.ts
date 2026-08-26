import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LlmCallLogEntity } from '@nom/database';
import {
  ADJUDICATOR_EXTRACTOR,
  EXTRACTOR_CONFIG,
  STRUCTURED_EXTRACTOR,
} from './llm/llm.tokens';
import { ANTHROPIC_LLM, GEMINI_LLM } from '../agents/llm/llm.tokens';
import { LangchainStructuredExtractor } from './llm/langchain.structured-extractor';
import { LoggingStructuredExtractor } from './llm/logging.structured-extractor';
import { LlmCallLogRepository } from './llm/llm-call-log.repository';
import type { ExtractorConfig } from './llm/structured-extractor.port';
import { DocumentGraphRepository } from './graph/document-graph.repository';
import { ServiceGraphRepository } from './graph/service-graph.repository';
import { CanonicalRegistryRepository } from './graph/canonical-registry.repository';
import { LineItemGraphRepository } from './graph/line-item-graph.repository';
import { RuleGraphRepository } from './graph/rule-graph.repository';

// Shared infrastructure ports: LLM structured extraction + typed Neo4j graph
// repositories. Global so any feature module can inject them without re-importing.
// The extractor is bound twice over one provider-agnostic class — Gemini for
// extraction, Anthropic/Haiku for reconcile/adjudicate.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([LlmCallLogEntity])],
  providers: [
    {
      provide: EXTRACTOR_CONFIG,
      useFactory: (): ExtractorConfig => ({
        defaultConcurrency: Number(process.env.LLM_MAX_CONCURRENCY ?? 4),
        defaultMaxAttempts: Number(process.env.LLM_MAX_ATTEMPTS ?? 2),
      }),
    },
    LlmCallLogRepository,
    {
      provide: STRUCTURED_EXTRACTOR,
      useFactory: (
        model: BaseChatModel,
        cfg: ExtractorConfig,
        log: LlmCallLogRepository,
      ) =>
        new LoggingStructuredExtractor(
          new LangchainStructuredExtractor(model, cfg),
          log,
          'gemini',
          cfg.defaultConcurrency,
        ),
      inject: [GEMINI_LLM, EXTRACTOR_CONFIG, LlmCallLogRepository],
    },
    {
      provide: ADJUDICATOR_EXTRACTOR,
      useFactory: (
        model: BaseChatModel,
        cfg: ExtractorConfig,
        log: LlmCallLogRepository,
      ) =>
        new LoggingStructuredExtractor(
          new LangchainStructuredExtractor(model, cfg),
          log,
          'anthropic',
          cfg.defaultConcurrency,
        ),
      inject: [ANTHROPIC_LLM, EXTRACTOR_CONFIG, LlmCallLogRepository],
    },
    DocumentGraphRepository,
    ServiceGraphRepository,
    CanonicalRegistryRepository,
    LineItemGraphRepository,
    RuleGraphRepository,
  ],
  exports: [
    STRUCTURED_EXTRACTOR,
    ADJUDICATOR_EXTRACTOR,
    DocumentGraphRepository,
    ServiceGraphRepository,
    CanonicalRegistryRepository,
    LineItemGraphRepository,
    RuleGraphRepository,
  ],
})
export class InfraModule {}
