import { MigrationInterface, QueryRunner } from "typeorm";

export class Documents1782196675892 implements MigrationInterface {
    name = 'Documents1782196675892'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "fileId" uuid NOT NULL, "vendorId" uuid, "documentType" text NOT NULL, "attributeSet" text, "status" text NOT NULL DEFAULT 'pending', "metadata" jsonb NOT NULL DEFAULT '{}', "warnings" jsonb NOT NULL DEFAULT '[]', "rejectReason" text, "effectiveFrom" TIMESTAMP WITH TIME ZONE, "effectiveTo" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f16eaa571c8fc0ee214cad0f1c" ON "documents" ("organizationId") `);
        await queryRunner.query(`CREATE TABLE "content" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" text NOT NULL, "documentId" uuid NOT NULL, "documentType" text NOT NULL, "label" text NOT NULL, "text" text NOT NULL, "position" integer NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_6a2083913f3647b44f205204e36" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_72e052028ad54548c1fedbca5a" ON "content" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2684d4ffb46615eab374f6fedf" ON "content" ("organizationId", "documentType", "documentId") `);
        await queryRunner.query(`ALTER TABLE "documents" ADD CONSTRAINT "FK_27f4230372010337b40536bb76d" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "documents" ADD CONSTRAINT "FK_3b76f289ec7e0efcf1461e27c91" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT "FK_3b76f289ec7e0efcf1461e27c91"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT "FK_27f4230372010337b40536bb76d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2684d4ffb46615eab374f6fedf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_72e052028ad54548c1fedbca5a"`);
        await queryRunner.query(`DROP TABLE "content"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f16eaa571c8fc0ee214cad0f1c"`);
        await queryRunner.query(`DROP TABLE "documents"`);
    }

}
