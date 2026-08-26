import { MigrationInterface, QueryRunner } from "typeorm";

export class DocumentReviewCompleted1783300000000 implements MigrationInterface {
    name = 'DocumentReviewCompleted1783300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" ADD "reviewCompleted" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "reviewCompleted"`);
    }

}
