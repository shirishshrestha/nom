import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ContentEntity,
  DocumentEntity,
  FileEntity,
  VendorEntity,
} from '@nom/database';
import { DocumentsService } from './documents.service';
import { DocumentValidationFlow } from './document-validation.flow';
import { DocumentRepository } from './persistence/document.repository';
import { DocumentExtractor } from './extraction/document-extractor';
import { VendorMatcher } from './validation/vendor-matcher';
import { S3Service } from '../files/s3.service';
import { RulesModule } from '../rules/rules.module';

// Shared ingest/validate services for any document type. Per-type modules
// (source, transaction) import this and own their own HTTP controllers.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentEntity,
      ContentEntity,
      FileEntity,
      VendorEntity,
    ]),
    RulesModule,
  ],
  // STRUCTURED_EXTRACTOR + graph repos (InfraModule) and Neo4jService (Neo4jModule) are global.
  providers: [
    DocumentsService,
    DocumentValidationFlow,
    DocumentRepository,
    DocumentExtractor,
    VendorMatcher,
    S3Service,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
