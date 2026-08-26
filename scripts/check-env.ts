/**
 * Standalone environment verifier for apps/api.
 *
 * Since the app reads configuration straight from `process.env` (no typed
 * ConfigService validation), this script is the single place that asserts the
 * required variables are present and well-formed. Run it before `dev`/`start`
 * so a misconfigured environment fails fast with a clear message instead of a
 * cryptic driver error deep in DI.
 *
 *   pnpm check-env          # from the repo root
 *   pnpm -w run check-env   # from any package
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Resolve apps/api/.env relative to this file (scripts/ lives at the repo root).
const ENV_PATH = resolve(__dirname, '../apps/api/.env');
config({ path: ENV_PATH });

type Rule = {
  name: string;
  /** 'required' = must be non-empty. 'present' = must be defined (empty allowed). 'optional' = may be missing. */
  level: 'required' | 'present' | 'optional';
  description: string;
  /** Returns an error message if the (defined, non-empty) value is invalid. */
  validate?: (value: string) => string | null;
};

const isPort = (value: string): string | null =>
  /^\d+$/.test(value) && +value > 0 && +value <= 65535
    ? null
    : `must be a port number 1-65535, got "${value}"`;

const hasPrefix =
  (prefixes: string[]) =>
  (value: string): string | null =>
    prefixes.some((p) => value.startsWith(p))
      ? null
      : `must start with one of ${prefixes.join(', ')}, got "${value}"`;

const RULES: Rule[] = [
  { name: 'PORT', level: 'optional', description: 'HTTP port (defaults to 3000)', validate: isPort },
  {
    name: 'DATABASE_URL',
    level: 'required',
    description: 'Postgres connection string',
    validate: hasPrefix(['postgres://', 'postgresql://']),
  },
  {
    name: 'NEO4J_URI',
    level: 'required',
    description: 'Neo4j bolt URI',
    validate: hasPrefix(['bolt://', 'bolt+s://', 'neo4j://', 'neo4j+s://']),
  },
  { name: 'NEO4J_USER', level: 'required', description: 'Neo4j username' },
  { name: 'NEO4J_PASSWORD', level: 'present', description: 'Neo4j password (may be empty for no-auth)' },
  { name: 'REDIS_HOST', level: 'required', description: 'Redis host for BullMQ' },
  { name: 'REDIS_PORT', level: 'optional', description: 'Redis port (defaults to 6379)', validate: isPort },
  { name: 'REDIS_PASSWORD', level: 'present', description: 'Redis password (may be empty)' },
  { name: 'TRANSACTION_MATCH_ASYNC', level: 'optional', description: "Run line-item matching on the BullMQ worker when 'true' (defaults to sync)" },
  { name: 'BETTER_AUTH_SECRET', level: 'required', description: 'Better Auth signing secret' },
  {
    name: 'BETTER_AUTH_URL',
    level: 'required',
    description: 'Public base URL of the API',
    validate: hasPrefix(['http://', 'https://']),
  },
  {
    name: 'WEB_URL',
    level: 'required',
    description: 'Web origin (CORS + trusted origin)',
    validate: hasPrefix(['http://', 'https://']),
  },
];

const errors: string[] = [];
const lines: string[] = [];

for (const rule of RULES) {
  const raw = process.env[rule.name];
  const defined = raw !== undefined;
  const empty = !defined || raw === '';

  let status: 'ok' | 'warn' | 'fail' = 'ok';
  let note = '';

  if (rule.level === 'required' && empty) {
    status = 'fail';
    note = 'missing (required)';
    errors.push(`${rule.name} is required but ${defined ? 'empty' : 'not set'} — ${rule.description}`);
  } else if (rule.level === 'present' && !defined) {
    status = 'fail';
    note = 'not set (must be defined)';
    errors.push(`${rule.name} must be defined (empty is allowed) — ${rule.description}`);
  } else if (rule.level === 'optional' && empty) {
    status = 'warn';
    note = 'using default';
  } else if (rule.validate && !empty) {
    const problem = rule.validate(raw as string);
    if (problem) {
      status = 'fail';
      note = problem;
      errors.push(`${rule.name} ${problem}`);
    }
  }

  const icon = status === 'ok' ? '✓' : status === 'warn' ? '•' : '✗';
  lines.push(`  ${icon} ${rule.name.padEnd(16)} ${note}`);
}

console.log(`\nEnvironment check (${ENV_PATH})\n`);
console.log(lines.join('\n'));

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nSee apps/api/.env.example for the expected values.\n');
  process.exit(1);
}

console.log('\n✓ Environment looks good.\n');
