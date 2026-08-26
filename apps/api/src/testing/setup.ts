export const DB = {
  type: 'postgres' as const,
  host: process.env.DB_TEST_HOST ?? 'localhost',
  port: Number(process.env.DB_TEST_PORT ?? 5432),
  username: process.env.DB_TEST_USERNAME ?? 'nom',
  password: process.env.DB_TEST_PASSWORD ?? 'nom',
  database: process.env.DB_TEST_NAME ?? 'nom_test',
};
