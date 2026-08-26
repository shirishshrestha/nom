import { MigrationInterface, QueryRunner } from "typeorm";

export class LlmCallLogTokens1783260000000 implements MigrationInterface {
    name = 'LlmCallLogTokens1783260000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "llm_call_logs" ADD "inputTokens" integer`);
        await queryRunner.query(`ALTER TABLE "llm_call_logs" ADD "outputTokens" integer`);
        await queryRunner.query(`ALTER TABLE "llm_call_logs" ADD "model" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "llm_call_logs" DROP COLUMN "model"`);
        await queryRunner.query(`ALTER TABLE "llm_call_logs" DROP COLUMN "outputTokens"`);
        await queryRunner.query(`ALTER TABLE "llm_call_logs" DROP COLUMN "inputTokens"`);
    }

}
