export const TEST_VENDOR_ID = '00000000-0000-0000-0000-000000000001';

export const TEST_ORGS = [
  'N0XoX8sccY8DCH07X281M6j8ixH43oKR',
  'bKpWYGZNfdid1bQgyisSWS8t3N0xLw7q',
];

export const TEST_ORG_ID = TEST_ORGS[0];
export const TEST_USER_ID = '909b016b-08b7-4594-9c0f-e0ed9b24d76f';
export const TEST_USER_EMAIL = 'xoma@xoma.com';

export const MOCK_ORG = {
  id: TEST_ORG_ID,
  name: 'Test Org',
  slug: 'test-org',
  createdAt: new Date(),
};

export const TEST_SESSION = {
  session: { activeOrganizationId: TEST_ORG_ID },
  user: { id: TEST_USER_ID, email: TEST_USER_EMAIL },
};

export const SOURCE_FILE_ID = '48e2fd20-f68c-4d7d-be2a-957923a9ba1e';
export const TRANSACTION_FILE_ID = 'ff176170-0b64-43e6-a34b-75d5b47e4b5a';

// Deterministic document id so preprocess is repeatable and extract-service can
// hardcode DOCUMENT_ID.
export const SOURCE_DOCUMENT_ID = 'dddf1744-f7dd-473a-a96f-4bdacbdb309b';
