import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      // factory runs lazily during DI resolution — after the app's ConfigModule
      // has loaded .env into process.env. Never read process.env at module top-level.
      useFactory: () => ({
        type: 'postgres' as const,
        url: process.env.DATABASE_URL,
        autoLoadEntities: true, // entities register via forFeature in the app
        synchronize: false, // migrations only
        // Compiled migrations sit next to this file in dist/ at runtime.
        migrations: [join(__dirname, 'migrations/*.js')],
        // ponytail: auto-run pending migrations on boot in prod (single box, single
        // replica). Move to a one-off migrate step if you ever run multiple API
        // replicas, to avoid concurrent-migration races. Dev keeps using the CLI.
        migrationsRun: process.env.NODE_ENV === 'production',
      }),
    }),
  ],
})
export class DatabaseModule {}
