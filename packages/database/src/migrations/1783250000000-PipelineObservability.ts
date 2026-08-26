import { MigrationInterface, QueryRunner } from "typeorm";

export class PipelineObservability1783250000000 implements MigrationInterface {
    name = 'PipelineObservability1783250000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pipeline_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "entityType" text NOT NULL, "entityId" uuid NOT NULL, "documentId" uuid NOT NULL, "messages" jsonb NOT NULL, CONSTRAINT "PK_pipeline_logs_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pipeline_logs_org" ON "pipeline_logs" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_pipeline_logs_org_doc" ON "pipeline_logs" ("organizationId", "documentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_pipeline_logs_org_entity" ON "pipeline_logs" ("organizationId", "entityType", "entityId") `);
        await queryRunner.query(`CREATE TABLE "pipeline_reasoning" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "entityType" text NOT NULL, "entityId" uuid NOT NULL, "documentId" uuid NOT NULL, "reasoning" jsonb, CONSTRAINT "PK_pipeline_reasoning_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_pipeline_reasoning_entity" UNIQUE ("organizationId", "entityType", "entityId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pipeline_reasoning_org" ON "pipeline_reasoning" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_pipeline_reasoning_org_doc" ON "pipeline_reasoning" ("organizationId", "documentId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_pipeline_reasoning_org_doc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pipeline_reasoning_org"`);
        await queryRunner.query(`DROP TABLE "pipeline_reasoning"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pipeline_logs_org_entity"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pipeline_logs_org_doc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pipeline_logs_org"`);
        await queryRunner.query(`DROP TABLE "pipeline_logs"`);
    }

}
