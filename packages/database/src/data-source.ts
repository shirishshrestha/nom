import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// Migration CLI runs standalone (no Nest) — load env ourselves from the app's .env
// so DATABASE_URL has a single source of truth.
config({ path: '../../apps/api/.env' });

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/entities/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
