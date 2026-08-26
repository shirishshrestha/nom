/**
 * Seed the test DB + S3 with one source + one transaction FileEntity ready for
 * document extraction.
 *   pnpm --filter api script src/testing/scripts/db/seed.script.ts
 * Prints the SOURCE_FILE_ID / TRANSACTION_FILE_ID to paste into the driver scripts.
 */
import { config } from 'dotenv';
config({ path: '.env' });

import { existsSync, readFileSync } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { FileEntity, VendorEntity, OrganizationEntity } from '@nom/database';
import { FILE_STATUSES, DOCUMENT_TYPES, FILE_CATEGORIES } from '@nom/shared';
import type { DocumentType } from '@nom/shared';
import { openDataSource, withNeo4j } from '../harness';
import {
  TEST_ORG_ID,
  TEST_VENDOR_ID,
  MOCK_ORG,
  SOURCE_FILE_ID,
  TRANSACTION_FILE_ID,
} from '@/testing/test-constants';
import { fixtureFor } from '@/testing/fixtures';
import type { DataSource } from 'typeorm';

// Fixed ids per type so seeding is idempotent (upsert) and driver scripts can
// hardcode them.
const FILE_ID_BY_TYPE: Record<string, string> = {
  [DOCUMENT_TYPES.SOURCE]: SOURCE_FILE_ID,
  [DOCUMENT_TYPES.TRANSACTION]: TRANSACTION_FILE_ID,
};

// Loads fixtures/<documentType>.pdf (e.g. source.pdf, transaction.pdf).
async function seedFile(
  ds: DataSource,
  s3: S3Client,
  documentType: DocumentType,
): Promise<string> {
  const fixture = fixtureFor(documentType);
  if (!existsSync(fixture)) throw new Error(`Missing fixture: ${fixture}`);
  const pdf = readFileSync(fixture);
  const storageKey = `test-org/${randomUUID()}.pdf`;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: storageKey,
      Body: pdf,
      ContentType: 'application/pdf',
    }),
  );

  const id = FILE_ID_BY_TYPE[documentType];
  await ds.getRepository(FileEntity).upsert(
    {
      id,
      name: `${documentType}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      documentType,
      category: FILE_CATEGORIES.DOCUMENT,
      storageKey,
      organizationId: TEST_ORG_ID,
      vendorId: TEST_VENDOR_ID,
      status: FILE_STATUSES.UPLOADED,
    },
    ['id'],
  );
  console.log(`${documentType} s3:`, storageKey);
  return id;
}

async function seed() {
  const ds = await openDataSource([
    OrganizationEntity,
    VendorEntity,
    FileEntity,
  ]);
  try {
    await ds
      .getRepository(OrganizationEntity)
      .upsert({ ...MOCK_ORG, createdAt: MOCK_ORG.createdAt ?? new Date() }, [
        'id',
      ]);
    console.log('org:', TEST_ORG_ID);

    await ds
      .getRepository(VendorEntity)
      .upsert(
        { id: TEST_VENDOR_ID, name: 'Northstar', organizationId: TEST_ORG_ID },
        ['id'],
      );
    console.log('vendor:', TEST_VENDOR_ID);

    // The :Vendor graph node is otherwise only created via the API (VendorsService.create).
    // writeGraph + COMMIT_CYPHER both MATCH on it, so without it nothing is written to Neo4j.
    // MERGE (not CREATE) — keeps the seed idempotent like its Postgres upserts.
    await withNeo4j((session) =>
      session.run('MERGE (v:Vendor {id: $id, tenantId: $tenantId})', {
        id: TEST_VENDOR_ID,
        tenantId: TEST_ORG_ID,
      }),
    );
    console.log('neo4j vendor:', TEST_VENDOR_ID);

    const s3 = new S3Client({ region: process.env.AWS_REGION! });

    const sourceId = await seedFile(ds, s3, DOCUMENT_TYPES.SOURCE);
    const transactionId = await seedFile(ds, s3, DOCUMENT_TYPES.TRANSACTION);

    console.log('\nSOURCE_FILE_ID =', sourceId);
    console.log('TRANSACTION_FILE_ID =', transactionId);
  } finally {
    await ds.destroy();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
