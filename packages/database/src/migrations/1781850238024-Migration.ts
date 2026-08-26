import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1781850238024 implements MigrationInterface {
    name = 'Migration1781850238024'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "name" text NOT NULL, "storageKey" text NOT NULL, "mimeType" text NOT NULL, "sizeBytes" integer NOT NULL, "documentType" text NOT NULL, "category" text NOT NULL DEFAULT 'document', "meta" jsonb, CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_91251e0e4807922dd5b3c14a6b" ON "files" ("organizationId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_91251e0e4807922dd5b3c14a6b"`);
        await queryRunner.query(`DROP TABLE "files"`);
    }

}
