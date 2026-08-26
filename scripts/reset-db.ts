/**
 * Reset / clean the databases (Postgres + Neo4j).
 *
 * Postgres: drops and recreates the `public` schema (wiping every table,
 *           including TypeORM's migrations table), then re-runs migrations so
 *           you end up on a clean, fully-migrated schema.
 * Neo4j:    DETACH DELETE every node and relationship.
 *
 *   pnpm reset-db                # wipe + re-migrate
 *   pnpm reset-db --no-migrate   # wipe only, leave Postgres schema empty
 *   pnpm reset-db --force        # allow even when NODE_ENV=production
 *
 * Reads connection settings from apps/api/.env.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import neo4j from 'neo4j-driver';
import { Client } from 'pg';

const ENV_PATH = resolve(__dirname, '../apps/api/.env');
config({ path: ENV_PATH });

const force = process.argv.includes('--force');
const skipMigrate = process.argv.includes('--no-migrate');

if (process.env.NODE_ENV === 'production' && !force) {
  console.error(
    'Refusing to reset databases with NODE_ENV=production. Pass --force to override.',
  );
  process.exit(1);
}

async function resetPostgres(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log('• Postgres: dropping and recreating schema "public"...');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await client.query('CREATE SCHEMA public;');
  } finally {
    await client.end();
  }

  if (skipMigrate) {
    console.log('• Postgres: skipping migrations (--no-migrate)');
    return;
  }
  console.log('• Postgres: running TypeORM migrations...');
  execSync('pnpm --filter @nom/database migration:run', { stdio: 'inherit' });

  console.log('• Postgres: applying Better Auth schema...');
  execSync(
    'npx -y @better-auth/cli@latest migrate -y --config ./src/auth/auth.config.ts',
    {
      stdio: 'inherit',
      cwd: resolve(__dirname, '../apps/api'),
    },
  );
}

async function resetNeo4j(): Promise<void> {
  const uri = process.env.NEO4J_URI;
  if (!uri) throw new Error('NEO4J_URI is not set');

  const driver = neo4j.driver(
    uri,
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? '',
      process.env.NEO4J_PASSWORD ?? '',
    ),
  );
  const session = driver.session();
  try {
    console.log('• Neo4j: detaching and deleting all nodes...');
    await session.run('MATCH (n) DETACH DELETE n');
  } finally {
    await session.close();
    await driver.close();
  }
}

async function main(): Promise<void> {
  console.log(`\nResetting databases (${ENV_PATH})\n`);
  await resetPostgres();
  await resetNeo4j();
  console.log('\n✓ Databases reset.\n');
}

main().catch((err: unknown) => {
  console.error(
    `\n✗ Reset failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
