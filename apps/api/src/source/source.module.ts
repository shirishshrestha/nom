import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ContentEntity,
  DocumentEntity,
  StagedServiceExtractionEntity,
} from '@nom/database';
import { SharedLoadingModule } from '../shared-loading/shared-loading.module';
import { DocumentsModule } from '../documents/documents.module';
import { RulesModule } from '../rules/rules.module';
import { SourceController } from './source.controller';
import { SourceService } from './source.service';
import { StagingRepository } from './staging/staging.repository';
import { ServiceExtractor } from './extraction/service-extractor';
import { CanonicalMatcher } from './extraction/canonical-matcher';
import { ServiceReferenceDetector } from './extraction/service-reference-detector';
import { SourceExtractFlow } from './extraction/extract-services.flow';
import { SourceCommitFlow } from './commit/commit-services.flow';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentEntity,
      ContentEntity,
      StagedServiceExtractionEntity,
    ]),
    SharedLoadingModule,
    DocumentsModule,
    RulesModule,
  ],
  controllers: [SourceController],
  // STRUCTURED_EXTRACTOR + graph repos (InfraModule) and Neo4jService (Neo4jModule) are global.
  providers: [
    SourceService,
    StagingRepository,
    ServiceExtractor,
    CanonicalMatcher,
    ServiceReferenceDetector,
    SourceExtractFlow,
    SourceCommitFlow,
  ],
  exports: [SourceService],
})
export class SourceModule {}
