import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from './neo4j.constants';

// Schema bootstrap — idempotent (IF NOT EXISTS); one statement per call since
// Neo4j forbids multiple schema commands in a single query.
const SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT vendor_id IF NOT EXISTS FOR (v:Vendor) REQUIRE v.id IS UNIQUE',
  'CREATE CONSTRAINT service_id IF NOT EXISTS FOR (s:Service) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT canonical_name_vendor IF NOT EXISTS FOR (c:CanonicalService) REQUIRE (c.canonicalName, c.vendorId, c.tenantId) IS UNIQUE',
  'CREATE INDEX canonical_vendor IF NOT EXISTS FOR (c:CanonicalService) ON (c.vendorId, c.tenantId)',
  'CREATE INDEX service_tenant IF NOT EXISTS FOR (s:Service) ON (s.tenantId)',
  'CREATE INDEX service_doc IF NOT EXISTS FOR (s:Service) ON (s.documentId, s.tenantId)',
  'CREATE FULLTEXT INDEX service_fulltext IF NOT EXISTS FOR (s:Service) ON EACH [s.title, s.canonicalName]',
  'CREATE FULLTEXT INDEX canonical_fulltext IF NOT EXISTS FOR (c:CanonicalService) ON EACH [c.canonicalName]',
  // v2: a changed ON EACH doesn't update an existing index, so this is a new name
  // rather than a redefinition of canonical_fulltext above (kept for compatibility).
  'CREATE FULLTEXT INDEX canonical_fulltext_v2 IF NOT EXISTS FOR (c:CanonicalService) ON EACH [c.canonicalName, c.description]',
  'CREATE CONSTRAINT lineitem_id IF NOT EXISTS FOR (li:LineItem) REQUIRE li.id IS UNIQUE',
  'CREATE INDEX lineitem_doc IF NOT EXISTS FOR (li:LineItem) ON (li.documentId, li.tenantId)',
  'CREATE CONSTRAINT rule_id IF NOT EXISTS FOR (r:Rule) REQUIRE r.id IS UNIQUE',
  'CREATE INDEX rule_vendor IF NOT EXISTS FOR (r:Rule) ON (r.vendorId, r.tenantId)',
  'CREATE FULLTEXT INDEX rule_fulltext IF NOT EXISTS FOR (r:Rule) ON EACH [r.title, r.content]',
];

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);

  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  async onModuleInit() {
    // Parallel — separate sessions run concurrently; the "one command per query"
    // rule is only about multiple schema commands in a single query.
    await Promise.all(
      SCHEMA_STATEMENTS.map((stmt) =>
        // non-fatal — log and continue so a transient Neo4j hiccup doesn't block boot
        this.write(stmt).catch((e) =>
          this.logger.warn(
            `Schema bootstrap failed: ${stmt} — ${(e as Error).message}`,
          ),
        ),
      ),
    );
  }

  async read(cypher: string, params?: Record<string, unknown>) {
    const session = this.driver.session();
    try {
      return (await session.executeRead((tx) => tx.run(cypher, params))).records;
    } finally {
      await session.close();
    }
  }

  async write(cypher: string, params?: Record<string, unknown>) {
    const session = this.driver.session();
    try {
      return (await session.executeWrite((tx) => tx.run(cypher, params))).records;
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy() {
    await this.driver.close();
  }
}
