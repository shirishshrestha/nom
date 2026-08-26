import { jest } from '@jest/globals';
import { TEST_ORG_ID } from './test-constants';

export const mockOrgsRepo = {
  findOneBy: jest
    .fn<any>()
    .mockResolvedValue({ id: TEST_ORG_ID, slug: 'test-org' }),
};

export const mockS3 = {
  getPresignedPutUrl: jest
    .fn<any>()
    .mockResolvedValue('https://s3.example.com/upload'),
  getPresignedGetUrl: jest
    .fn<any>()
    .mockResolvedValue('https://s3.example.com/download'),
  // DocumentExtractor reads bytes before the (faked) LLM call; contents are ignored.
  getObjectBytes: jest
    .fn<any>()
    .mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
};

// Commit-aware Neo4j stub: read/write return driver-style records exposing .get().
// commitServices asserts serviceCount === rows.length, so the COMMIT write (the one
// carrying `rows`) echoes that count; all other writes/reads return empty.
export const mockNeo4j = {
  read: jest.fn<any>().mockResolvedValue([]),
  write: jest.fn<any>((_cypher: string, params?: { rows?: unknown[] }) =>
    Promise.resolve(
      params?.rows
        ? [
            {
              get: (k: string) =>
                k === 'serviceCount'
                  ? params.rows!.length
                  : k === 'canonicalCount'
                    ? 1
                    : null,
            },
          ]
        : [],
    ),
  ),
};
