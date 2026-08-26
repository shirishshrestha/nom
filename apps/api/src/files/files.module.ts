import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity, OrganizationEntity, VendorEntity } from '@nom/database';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { S3Service } from './s3.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, OrganizationEntity, VendorEntity]),
    DocumentsModule,
  ],
  controllers: [FilesController],
  providers: [FilesService, S3Service],
})
export class FilesModule {}
