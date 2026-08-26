import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity, FileEntity, VendorEntity } from '@nom/database';
import { Neo4jModule } from '@nom/neo4j';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([VendorEntity, FileEntity, DocumentEntity]),
    Neo4jModule,
  ],
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
