import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorEntity } from '@nom/database';
import { RulesService } from './rules.service';
import { RulesController } from './rules.controller';

// RuleGraphRepository is provided globally by InfraModule.
@Module({
  imports: [TypeOrmModule.forFeature([VendorEntity])],
  controllers: [RulesController],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
