/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import type { DocumentEntity } from '@nom/database';
import { TEST_ORG_ID } from '../../testing/test-constants';
import type { TransactionMatchFlow } from './match-line-items.flow';
import { MatchProcessor, type MatchJobData } from './match.processor';

const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();
const job = (data: MatchJobData) => ({ data }) as unknown as Job<MatchJobData>;

function build() {
  const matchFlow = {
    run: asyncFn(),
  } as unknown as jest.Mocked<TransactionMatchFlow>;
  (matchFlow.run as any).mockResolvedValue({});
  const documentsRepo = { update: asyncFn() } as unknown as jest.Mocked<
    Repository<DocumentEntity>
  >;
  (documentsRepo.update as any).mockResolvedValue(undefined);
  const processor = new MatchProcessor(matchFlow, documentsRepo);
  return { processor, matchFlow, documentsRepo };
}

describe('MatchProcessor', () => {
  it('runs the match flow and flips the doc to matched on success', async () => {
    const { processor, matchFlow, documentsRepo } = build();
    await processor.process(
      job({ organizationId: TEST_ORG_ID, documentId: 'doc-1' }),
    );
    expect(matchFlow.run).toHaveBeenCalledWith(TEST_ORG_ID, 'doc-1');
    expect(documentsRepo.update).toHaveBeenCalledWith(
      { id: 'doc-1', organizationId: TEST_ORG_ID },
      { status: 'matched' },
    );
  });

  it('reverts the doc to committed and rethrows when the flow fails', async () => {
    const { processor, matchFlow, documentsRepo } = build();
    const boom = new Error('flow exploded');
    (matchFlow.run as any).mockRejectedValue(boom);

    await expect(
      processor.process(
        job({ organizationId: TEST_ORG_ID, documentId: 'doc-1' }),
      ),
    ).rejects.toBe(boom);
    expect(documentsRepo.update).toHaveBeenCalledWith(
      { id: 'doc-1', organizationId: TEST_ORG_ID },
      { status: 'committed' },
    );
  });
});
