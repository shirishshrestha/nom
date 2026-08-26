import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import type { Repository } from 'typeorm';
import {
  ContentEntity,
  DocumentEntity,
  FileEntity,
  PipelineLogEntity,
  PipelineReasoningEntity,
} from '@nom/database';
import { OBSERVABILITY_ENTITY_TYPES } from '@nom/shared';
import { SharedLoadingModule } from '../shared-loading/shared-loading.module';
import { DocumentsModule } from '../documents/documents.module';
import { RulesModule } from '../rules/rules.module';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { LineItemExtractor } from './extraction/line-item-extractor';
import { TransactionExtractFlow } from './extraction/extract-line-items.flow';
import { LineItemMatcher } from './matching/line-item-matcher';
import { SymbolResolver } from './matching/symbol-resolver';
import { SiblingSymbolResolver } from './matching/sibling-symbol-resolver';
import { ReferencedExpressionComposer } from './matching/referenced-expression-composer';
import { AmountReconciler } from './matching/amount-reconciler';
import { NarrativeGenerator } from './matching/narrative-generator';
import { TransactionMatchFlow } from './matching/match-line-items.flow';
import { MatchProcessor, MATCH_QUEUE } from './matching/match.processor';
import { PipelineLogRepository } from './persistence/pipeline-log.repository';
import { PipelineReasoningRepository } from './persistence/pipeline-reasoning.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentEntity,
      ContentEntity,
      FileEntity,
      PipelineLogEntity,
      PipelineReasoningEntity,
    ]),
    BullModule.registerQueue({ name: MATCH_QUEUE }),
    SharedLoadingModule,
    DocumentsModule,
    RulesModule,
  ],
  controllers: [TransactionController],
  // STRUCTURED_EXTRACTOR / ADJUDICATOR_EXTRACTOR + graph repos (InfraModule) and
  // Neo4jService (Neo4jModule) are global.
  providers: [
    TransactionService,
    LineItemExtractor,
    TransactionExtractFlow,
    LineItemMatcher,
    SymbolResolver,
    SiblingSymbolResolver,
    ReferencedExpressionComposer,
    AmountReconciler,
    NarrativeGenerator,
    TransactionMatchFlow,
    MatchProcessor,
    // Observability repos are bound to the line-item pipeline at construction, so a
    // read/write can never span pipelines. A future pipeline (e.g. SERVICE) gets its
    // own provider token bound to its own entity type.
    {
      provide: PipelineLogRepository,
      useFactory: (repo: Repository<PipelineLogEntity>) =>
        new PipelineLogRepository(repo, OBSERVABILITY_ENTITY_TYPES.LINE_ITEM),
      inject: [getRepositoryToken(PipelineLogEntity)],
    },
    {
      provide: PipelineReasoningRepository,
      useFactory: (repo: Repository<PipelineReasoningEntity>) =>
        new PipelineReasoningRepository(
          repo,
          OBSERVABILITY_ENTITY_TYPES.LINE_ITEM,
        ),
      inject: [getRepositoryToken(PipelineReasoningEntity)],
    },
  ],
  exports: [TransactionService],
})
export class TransactionModule {}
