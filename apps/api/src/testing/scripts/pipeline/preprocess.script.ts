/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Drive the full document preprocessing pipeline through the HTTP controller layer.
 *   pnpm --filter api script src/testing/scripts/pipeline/preprocess.script.ts
 */
import { config } from 'dotenv';
config({ path: '.env' });

import { DataSource } from 'typeorm';
import { bootstrapApp } from '../harness';
import { SOURCE_DOCUMENT_ID, SOURCE_FILE_ID } from '@/testing/test-constants';

// ponytail: REPLACE_ME guard — fail fast rather than a silent 422 on a bad UUID
const FILE_ID = SOURCE_FILE_ID || 'REPLACE_ME';
const DOCUMENT_ID = SOURCE_DOCUMENT_ID;

async function run() {
  const { app, request, teardown } = await bootstrapApp();
  try {
    // Clean any prior run so the fixed DOCUMENT_ID is free to claim.
    const dataSource = app.get(DataSource);
    await dataSource.query('DELETE FROM content WHERE "documentId" = $1', [
      DOCUMENT_ID,
    ]);
    await dataSource.query(
      'DELETE FROM staged_service_extractions WHERE "documentId" = $1',
      [DOCUMENT_ID],
    );
    await dataSource.query('DELETE FROM documents WHERE id = $1', [
      DOCUMENT_ID,
    ]);

    console.log('\n=== POST /source/:id/extract ===');
    const extractRes = await request()
      .post(`/source/${FILE_ID}/extract`)
      .send();
    console.dir(extractRes.body, { depth: 6 });

    const result: { documentId: string } = extractRes.body?.data ?? {};

    // Re-point the freshly-created document (+ its content) to the fixed id so the
    // pipeline is repeatable and extract-service can hardcode DOCUMENT_ID.
    await dataSource.query('UPDATE documents SET id = $1 WHERE id = $2', [
      DOCUMENT_ID,
      result.documentId,
    ]);
    await dataSource.query(
      'UPDATE content SET "documentId" = $1 WHERE "documentId" = $2',
      [DOCUMENT_ID, result.documentId],
    );

    console.log(`\n=== POST /source/${DOCUMENT_ID}/validate ===`);
    const validateRes = await request()
      .post(`/source/${DOCUMENT_ID}/validate`)
      .send();
    console.dir(validateRes.body, { depth: 6 });
  } finally {
    await teardown();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
