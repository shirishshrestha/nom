import { MigrationInterface, QueryRunner } from "typeorm";

export class StagedServiceStatus1782369369840 implements MigrationInterface {
    name = 'StagedServiceStatus1782369369840'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staged_service_extractions" RENAME COLUMN "committed" TO "status"`);
        await queryRunner.query(`ALTER TABLE "staged_service_extractions" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "staged_service_extractions" ADD "status" text NOT NULL DEFAULT 'staged'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staged_service_extractions" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "staged_service_extractions" ADD "status" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "staged_service_extractions" RENAME COLUMN "status" TO "committed"`);
    }

}
