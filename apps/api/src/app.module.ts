import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggingInterceptor } from './common/logging.interceptor';
import { DatabaseModule } from '@nom/database';
import { Neo4jModule } from '@nom/neo4j';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentsModule } from './agents/agents.module';
import { InfraModule } from './infra/infra.module';
import { AttributeSetModule } from './attribute-set';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { VendorsModule } from './vendors/vendors.module';
import { RulesModule } from './rules/rules.module';
import { DocumentsModule } from './documents/documents.module';
import { SourceModule } from './source/source.module';
import { TransactionModule } from './transaction/transaction.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    DatabaseModule,
    Neo4jModule,
    AgentsModule,
    InfraModule,
    AttributeSetModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
        },
      }),
    }),
    // Our wrapper around the Better Auth integration (mounts /api/auth/* and
    // registers the global AuthGuard).
    AuthModule,
    FilesModule,
    VendorsModule,
    RulesModule,
    DocumentsModule,
    SourceModule,
    TransactionModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
