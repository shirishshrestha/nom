import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782112026286 implements MigrationInterface {
    name = 'Migration1782112026286'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE IF EXISTS "vendors" CASCADE
            `)
        await queryRunner.query(`CREATE TABLE "vendors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "name" text NOT NULL, "code" text, "type" text, "location" text, "comments" text, CONSTRAINT "PK_9c956c9797edfae5c6ddacc4e6e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5acc7c72826f006578faf5d344" ON "vendors" ("organizationId") `);
        await queryRunner.query(`ALTER TABLE "files" ADD "vendorId" uuid`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "FK_652eed9c3cc98f9b13dbdfe4f02" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "FK_652eed9c3cc98f9b13dbdfe4f02"`);
        await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "vendorId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5acc7c72826f006578faf5d344"`);
        await queryRunner.query(`DROP TABLE "vendors"`);
    }

}
