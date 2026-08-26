const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = async () => {
  const host = process.env.DB_TEST_HOST     ?? 'localhost';
  const port = process.env.DB_TEST_PORT     ?? '5432';
  const user = process.env.DB_TEST_USERNAME ?? 'nom';
  const pass = process.env.DB_TEST_PASSWORD ?? 'nom';
  const db   = process.env.DB_TEST_NAME     ?? 'nom_test';
  const url  = `postgres://${user}:${pass}@${host}:${port}/${db}`;

  const opts = { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit', shell: true };

  execSync('pnpm migration:run', { cwd: path.resolve(__dirname, '../../../../packages/database'), ...opts });
  execSync('pnpm auth:migrate',      { cwd: path.resolve(__dirname, '../../'), ...opts });
};
