import { Global, Module } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from './neo4j.constants';
import { Neo4jService } from './neo4j.service';

@Global()
@Module({
  providers: [
    {
      provide: NEO4J_DRIVER,
      // factory runs lazily — process.env is populated by the app's ConfigModule
      useFactory: (): Driver =>
        neo4j.driver(
          process.env.NEO4J_URI!,
          neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
        ),
    },
    Neo4jService,
  ],
  exports: [Neo4jService],
})
export class Neo4jModule {}
