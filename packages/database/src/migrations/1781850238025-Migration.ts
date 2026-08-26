import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1781850238025 implements MigrationInterface {
  name = 'Migration1781850238025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" ADD "status" text NOT NULL DEFAULT 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "status"`);
  }
}
