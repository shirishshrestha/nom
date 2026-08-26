import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity, VendorEntity } from '@nom/database';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// LineItemGraphRepository (InfraModule) and Neo4jService (Neo4jModule) are global.
@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity, VendorEntity])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
