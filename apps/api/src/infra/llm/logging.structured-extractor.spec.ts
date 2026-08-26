import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { LoggingStructuredExtractor } from './logging.structured-extractor';
import type {
  LlmCallLogInput,
  LlmCallLogRepository,
} from './llm-call-log.repository';
import type {
  ExtractionRequest,
  StructuredExtractor,
} from './structured-extractor.port';

// In-memory repo double — collects the rows the decorator tries to write.
class FakeLogRepo {
  readonly rows: LlmCallLogInput[] = [];
  record(input: LlmCallLogInput): Promise<void> {
    this.rows.push(input);
    return Promise.resolve();
  }
}

const schema = z.object({ ok: z.boolean() });
const reference = {
  organizationId: 'org-1',
  sourceType: 'document',
  sourceId: 'doc-1',
};

// Inner extractor stub: returns a canned output, or throws if `fail` is set.
function inner(output: unknown, fail?: Error): StructuredExtractor {
  return {
    extract: () => (fail ? Promise.reject(fail) : Promise.resolve(output)),
    extractMany: () => Promise.reject(new Error('not used')),
  } as unknown as StructuredExtractor;
}

function req(
  over: Partial<ExtractionRequest<unknown>> = {},
): ExtractionRequest<unknown> {
  return {
    system: 'sys',
    human: 'hi',
    schema,
    options: { operation: 'txn.match@v2', reference },
    ...over,
  };
}

function build(repo: FakeLogRepo, ...args: Parameters<typeof inner>) {
  return new LoggingStructuredExtractor(
    inner(...args),
    repo as unknown as LlmCallLogRepository,
    'anthropic',
    4,
  );
}

describe('LoggingStructuredExtractor', () => {
  it('writes a succeeded row with split promptId/version and provider', async () => {
    const repo = new FakeLogRepo();
    const out = await build(repo, { ok: true }).extract(req());

    expect(out).toEqual({ ok: true });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      organizationId: 'org-1',
      sourceType: 'document',
      sourceId: 'doc-1',
      promptId: 'txn.match',
      promptVersion: 'v2',
      provider: 'anthropic',
      systemPrompt: 'sys',
      humanPrompt: 'hi',
      output: { ok: true },
      succeeded: true,
      errorMessage: null,
    });
    expect(typeof repo.rows[0].durationMs).toBe('number');
    expect(repo.rows[0].occurredAt).toBeInstanceOf(Date);
  });

  it('captures the inner extractor onUsage tokens + model onto the row', async () => {
    const repo = new FakeLogRepo();
    // Inner extractor that fires the usage sink the way the LangChain impl does.
    const usageInner = {
      extract: (r: ExtractionRequest<unknown>) => {
        r.options?.onUsage?.({
          inputTokens: 1200,
          outputTokens: 340,
          model: 'claude-haiku-4-5',
        });
        return Promise.resolve({ ok: true });
      },
      extractMany: () => Promise.reject(new Error('not used')),
    } as unknown as StructuredExtractor;
    const ext = new LoggingStructuredExtractor(
      usageInner,
      repo as unknown as LlmCallLogRepository,
      'anthropic',
      4,
    );

    await ext.extract(req());
    expect(repo.rows[0]).toMatchObject({
      inputTokens: 1200,
      outputTokens: 340,
      model: 'claude-haiku-4-5',
    });
  });

  it('defaults tokens + model to null when the inner never reports usage', async () => {
    const repo = new FakeLogRepo();
    await build(repo, { ok: true }).extract(req());
    expect(repo.rows[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      model: null,
    });
  });

  it('records a failed row and rethrows the original error', async () => {
    const repo = new FakeLogRepo();
    const boom = new Error('model exploded');

    await expect(build(repo, null, boom).extract(req())).rejects.toBe(boom);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      succeeded: false,
      errorMessage: 'model exploded',
      output: null,
    });
  });

  it('swallows a repo-write failure (warns) without surfacing it', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const repo = {
      record: () => Promise.reject(new Error('db down')),
    } as unknown as LlmCallLogRepository;
    const ext = new LoggingStructuredExtractor(
      inner({ ok: true }),
      repo,
      'gemini',
      4,
    );

    await expect(ext.extract(req())).resolves.toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('redacts media parts to shape only — never the base64 bytes', async () => {
    const repo = new FakeLogRepo();
    await build(repo, { ok: true }).extract(
      req({
        human: [
          { type: 'text', text: 'look' },
          { type: 'media', mimeType: 'image/png', dataBase64: 'AAAABBBB' },
        ],
      }),
    );

    expect(repo.rows[0].humanPrompt).toEqual([
      { type: 'text', text: 'look' },
      { type: 'media', mimeType: 'image/png', byteLength: 8 },
    ]);
    expect(JSON.stringify(repo.rows[0].humanPrompt)).not.toContain('AAAABBBB');
  });

  it('skips the write (one warn, no row) when reference is absent', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const repo = new FakeLogRepo();
    await build(repo, { ok: true }).extract(
      req({ options: { operation: 'txn.match@v2' } }),
    );

    expect(repo.rows).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('extractMany caps in-flight calls at the configured default when none is passed', async () => {
    let inFlight = 0;
    let peak = 0;
    const trackingInner = {
      extract: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { ok: true };
      },
      extractMany: () => Promise.reject(new Error('not used')),
    } as unknown as StructuredExtractor;
    const ext = new LoggingStructuredExtractor(
      trackingInner,
      new FakeLogRepo() as unknown as LlmCallLogRepository,
      'gemini',
      2,
    );

    await ext.extractMany(['a', 'b', 'c', 'd', 'e'], () => req(), {
      operation: 'txn.match@v2',
    });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('extractMany logs one row per item, preserving each build reference', async () => {
    const repo = new FakeLogRepo();
    const ext = build(repo, { ok: true });

    const results = await ext.extractMany(
      ['a', 'b', 'c'],
      (id) => req({ system: `sys-${id}` }),
      { operation: 'txn.match@v2' },
    );

    expect(results).toHaveLength(3);
    expect(repo.rows).toHaveLength(3);
    expect(repo.rows.map((r) => r.systemPrompt).sort()).toEqual([
      'sys-a',
      'sys-b',
      'sys-c',
    ]);
  });
});
