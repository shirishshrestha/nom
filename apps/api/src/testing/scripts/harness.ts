/**
 * Shared bootstrap for the `testing/scripts/*` runners so each script is just
 * its flow. Two helpers:
 *  - bootstrapApp()    — a Nest app wired to the document pipeline, AuthGuard
 *                        bypassed (TEST_SESSION injected), ready for supertest.
 *  - openDataSource()  — an initialised TypeORM DataSource for raw-SQL scripts.
 *  - withNeo4j()       — open a driver+session, run fn, always close both.
 */
import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type DataSourceOptions } from 'typeorm';
import neo4j, { type Session } from 'neo4j-driver';
import request from 'supertest';
import {
  DocumentEntity,
  ContentEntity,
  FileEntity,
  StagedServiceExtractionEntity,
  VendorEntity,
} from '@nom/database';
import { Neo4jModule } from '@nom/neo4j';
import { AgentsModule } from '@/agents/agents.module';
import { InfraModule } from '@/infra/infra.module';
import { AttributeSetModule } from '@/attribute-set';
import { SourceModule } from '@/source/source.module';
import { DB } from '@/testing/setup';
import { TEST_SESSION } from '@/testing/test-constants';

// Full pipeline entity set — superset used by every HTTP-driver script.
const PIPELINE_ENTITIES = [
  DocumentEntity,
  ContentEntity,
  FileEntity,
  StagedServiceExtractionEntity,
  VendorEntity,
];

type SuperTestRequest = ReturnType<typeof request>;

export interface ScriptApp {
  app: INestApplication;
  /** Fresh supertest handle bound to the running server. */
  request: () => SuperTestRequest;
  teardown: () => Promise<void>;
}

/** Boots the documents pipeline over HTTP with the AuthGuard bypassed. */
export async function bootstrapApp(): Promise<ScriptApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        ...DB,
        entities: PIPELINE_ENTITIES,
        synchronize: false,
      }),
      AgentsModule,
      InfraModule,
      AttributeSetModule,
      Neo4jModule,
      SourceModule,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  // bypass AuthGuard — inject session directly so @OrgSession() picks it up
  app.use((req: { session?: unknown }, _res: unknown, next: () => void) => {
    req.session = TEST_SESSION;
    next();
  });
  app.useGlobalPipes(new ValidationPipe());
  await app.init();

  return {
    app,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    request: () => request(app.getHttpServer()),
    teardown: () => app.close(),
  };
}

/** Initialised DataSource for raw-SQL scripts (seed/cleanup). */
export async function openDataSource(
  entities: DataSourceOptions['entities'] = [],
): Promise<DataSource> {
  const ds = new DataSource({ ...DB, entities, synchronize: false });
  await ds.initialize();
  return ds;
}

/** Opens a Neo4j driver+session, runs fn, and always closes both. */
export async function withNeo4j<T>(
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
  );
  try {
    const session = driver.session();
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}
