import { MigrationInterface, QueryRunner } from "typeorm";

export class LlmCallLog1782991965712 implements MigrationInterface {
    name = 'LlmCallLog1782991965712'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "llm_call_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "promptId" text NOT NULL, "promptVersion" text NOT NULL, "provider" text NOT NULL, "sourceType" text, "sourceId" text, "systemPrompt" text NOT NULL, "humanPrompt" jsonb NOT NULL, "output" jsonb, "succeeded" boolean NOT NULL, "errorMessage" text, "durationMs" integer NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_ad84866fef0164fcee07558a67d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_58a393814de0076a8824ef6bdd" ON "llm_call_logs" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_766df74027317512bb6e19bb14" ON "llm_call_logs" ("organizationId", "sourceType", "sourceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c0e4f64e8ee91148b5146fdc11" ON "llm_call_logs" ("organizationId", "createdAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c0e4f64e8ee91148b5146fdc11"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_766df74027317512bb6e19bb14"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_58a393814de0076a8824ef6bdd"`);
        await queryRunner.query(`DROP TABLE "llm_call_logs"`);
    }

}
