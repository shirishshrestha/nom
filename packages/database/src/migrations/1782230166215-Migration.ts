import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782230166215 implements MigrationInterface {
    name = 'Migration1782230166215'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "staged_service_extractions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "documentId" uuid NOT NULL, "fileId" uuid NOT NULL, "fileName" text NOT NULL, "vendorId" uuid, "attributeSet" text NOT NULL, "version" integer NOT NULL, "origin" text NOT NULL DEFAULT 'extract', "services" jsonb NOT NULL DEFAULT '[]', "committed" boolean NOT NULL DEFAULT false, "committedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3fa7dc26d004b89255290d59889" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8bc2298c5b604838a30ebc4958" ON "staged_service_extractions" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6dd7ea6699a2b8f909e47efcea" ON "staged_service_extractions" ("organizationId", "documentId", "version") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_6dd7ea6699a2b8f909e47efcea"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8bc2298c5b604838a30ebc4958"`);
        await queryRunner.query(`DROP TABLE "staged_service_extractions"`);
    }

}
