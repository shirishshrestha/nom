/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/**
 * Drive the service extraction → review → save flow through the HTTP layer.
 *   pnpm --filter api script src/testing/scripts/pipeline/extract-service.script.ts
 *
 * Requires an already-VALIDATED source document (quotation/insurance).
 */
import { config } from 'dotenv';
config({ path: '.env' });

import { bootstrapApp } from '../harness';
import { SOURCE_DOCUMENT_ID } from '@/testing/test-constants';

const DOCUMENT_ID: string = SOURCE_DOCUMENT_ID;

// Print a response body without the verbose per-service `meta` provenance bag.
const show = (o: unknown) =>
  console.log(JSON.stringify(o, (k, v) => (k === 'meta' ? undefined : v), 2));

async function run() {
  if (DOCUMENT_ID === 'REPLACE_ME')
    throw new Error('Set DOCUMENT_ID to a validated source document id');

  const { request, teardown } = await bootstrapApp();
  try {
    console.log(`\n=== POST /source/${DOCUMENT_ID}/extract-services ===`);
    const extractRes = await request()
      .post(`/source/${DOCUMENT_ID}/extract-services`)
      .send();
    show(extractRes.body);

    const services: { id: string; attributes: Record<string, unknown> }[] =
      extractRes.body?.data?.services ?? [];

    // Echo the reviewed services back (attributes only) — the save endpoint takes
    // the human-edited values. Here we send them unchanged.
    const edits = services.map((s) => ({ id: s.id, attributes: s.attributes }));

    console.log(`\n=== POST /source/${DOCUMENT_ID}/save-services ===`);
    const saveRes = await request()
      .post(`/source/${DOCUMENT_ID}/save-services`)
      .send({ services: edits });
    show(saveRes.body);
  } finally {
    await teardown();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
