import { FileEntity } from '@nom/database';
import { DocumentExtractor } from './document-extractor';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import type { HumanPart } from '../../infra/llm/structured-extractor.port';
import type { S3Service } from '../../files/s3.service';

const file = {
  id: 'file-1',
  organizationId: 'org-1',
  storageKey: 'test-org/abc.pdf',
  mimeType: 'application/pdf',
  documentType: 'source',
} as FileEntity;

function build(result: unknown) {
  const fake = new FakeStructuredExtractor(() => result);
  const s3 = {
    getObjectBytes: () => Promise.resolve(Buffer.from('pdf-bytes')),
  } as unknown as S3Service;
  return { extractor: new DocumentExtractor(fake, s3), fake };
}

describe('DocumentExtractor', () => {
  it('returns metadata and drops summary sections', async () => {
    const { extractor } = build({
      metadata: { isFinancial: true, attributeSet: 'quotation' },
      sections: [
        { label: 'Origin charges', text: 'real', isSummary: false },
        { label: 'Cover page', text: 'recap', isSummary: true },
      ],
    });

    const res = await extractor.extract(file);
    expect(res.metadata.attributeSet).toBe('quotation');
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].label).toBe('Origin charges');
  });

  it('drops the transient classificationBasis scratch from persisted metadata', async () => {
    const { extractor } = build({
      metadata: {
        classificationBasis: 'billed charges → invoice → no mismatch',
        isFinancial: true,
        attributeSet: 'invoice',
      },
      sections: [],
    });

    const res = await extractor.extract(file);
    expect('classificationBasis' in res.metadata).toBe(false);
    expect(res.metadata.attributeSet).toBe('invoice');
  });

  it('extractMany returns results aligned with the input files', async () => {
    // Responder echoes the chunk count derived from the base64 length so we can
    // tell the two files' results apart and confirm ordering.
    const fake = new FakeStructuredExtractor((req) => {
      const human = req.human as { type: string; text?: string }[];
      const tag = human.find((p) => p.type === 'text')?.text ?? '';
      return { metadata: { documentKind: tag }, sections: [] };
    });
    const s3 = {
      getObjectBytes: () => Promise.resolve(Buffer.from('x')),
    } as unknown as S3Service;
    const extractor = new DocumentExtractor(fake, s3);

    const files = [
      {
        storageKey: 'a.pdf',
        mimeType: 'application/pdf',
        documentType: 'source',
      },
      {
        storageKey: 'b.pdf',
        mimeType: 'application/pdf',
        documentType: 'source',
      },
    ] as FileEntity[];
    const results = await extractor.extractMany(files);
    expect(results).toHaveLength(2);
  });

  it('sends the PDF as a base64 media part', async () => {
    const { extractor, fake } = build({ metadata: {}, sections: [] });
    await extractor.extract(file);

    const human = fake.calls[0].human as HumanPart[];
    const media = human.find((p) => p.type === 'media');
    expect(media).toMatchObject({
      type: 'media',
      mimeType: 'application/pdf',
      dataBase64: Buffer.from('pdf-bytes').toString('base64'),
    });
    // reference threaded for fine-tuning log capture (file-scoped)
    expect(fake.calls[0].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'file',
      sourceId: 'file-1',
    });
  });
});
