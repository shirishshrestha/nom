import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentEntity, DocumentEntity, FileEntity } from '@nom/database';
import { DocumentContextLoader } from './document-context.loader';

// Shared document-loading layer consumed by both the documents and source modules.
@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity, ContentEntity, FileEntity]),
  ],
  providers: [DocumentContextLoader],
  exports: [DocumentContextLoader],
})
export class SharedLoadingModule {}
