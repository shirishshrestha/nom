/**
 * Wipe the test Postgres DB + Neo4j tenant graph back to a clean slate so the
 * seed → preprocess → extract-service pipeline can be re-run from scratch.
 *   pnpm --filter api script src/testing/scripts/db/cleanup.script.ts
 */
import { config } from 'dotenv';
config({ path: '.env' });

import { openDataSource, withNeo4j } from '../harness';
import { TEST_ORGS } from '@/testing/test-constants';

// Wipe every domain table EXCEPT the keep-set, computed dynamically so a new
// table is cleaned automatically (no hardcoded list to drift). Kept intact:
// user + auth (wiping would kill sessions), organization + membership (seed
// re-upserts the org), vendors (the registry), and TypeORM's migrations table.
const KEEP = new Set([
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'team',
  'teamMember',
  'member',
  'invitation',
  'vendors',
  'migrations',
]);

async function cleanup() {
  const ds = await openDataSource();
  try {
    const rows: { tablename: string }[] = await ds.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tables = rows
      .map((r) => r.tablename)
      .filter((t) => !KEEP.has(t))
      .map((t) => `"${t}"`); // quote to preserve camelCase / reserved names
    if (tables.length === 0) {
      console.log('pg: nothing to truncate');
    } else {
      await ds.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
      console.log('pg: truncated', tables.join(', '));
    }
  } finally {
    await ds.destroy();
  }

  await withNeo4j(async (session) => {
    // Keep :Vendor nodes (parity with vendors staying in Postgres); delete every
    // other node for the tenant (Service, CanonicalService, SourceDocument, …).
    for (const tenantId of TEST_ORGS)
      await session.run(
        'MATCH (n {tenantId: $tenantId}) WHERE NOT n:Vendor DETACH DELETE n',
        { tenantId },
      );
    console.log(
      'neo4j: deleted non-vendor tenant nodes for',
      TEST_ORGS.join(', '),
    );
  });
}

cleanup().catch((e) => {
  console.error(e);
  process.exit(1);
});
