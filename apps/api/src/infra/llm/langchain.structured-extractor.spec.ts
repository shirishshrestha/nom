/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { z } from 'zod';
import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LangchainStructuredExtractor } from './langchain.structured-extractor';
import type { ExtractorConfig } from './structured-extractor.port';
import { DocumentTooLargeError } from './llm-error';

const SCHEMA = z.object({ value: z.string() });
const CFG: ExtractorConfig = { defaultConcurrency: 2, defaultMaxAttempts: 1 };

// Minimal stub of the bits of BaseChatModel the extractor touches. With
// includeRaw, withStructuredOutput's runnable resolves to { raw, parsed }.
function stubModel(opts?: {
  onInvoke?: (messages: unknown) => unknown;
  capture?: (e: { schema: unknown; retry?: number }) => void;
  finishReason?: string;
  model?: string;
  responseModel?: string;
}) {
  const model = {
    model: opts?.model,
    withStructuredOutput(schema: unknown) {
      const makeRunnable = (retry?: number) => ({
        withRetry({ stopAfterAttempt }: { stopAfterAttempt: number }) {
          opts?.capture?.({ schema, retry: stopAfterAttempt });
          return makeRunnable(stopAfterAttempt);
        },
        invoke(messages: unknown) {
          opts?.capture?.({ schema, retry });
          const parsed = opts?.onInvoke
            ? opts.onInvoke(messages)
            : { value: 'ok' };
          return Promise.resolve({
            parsed,
            raw: {
              response_metadata: {
                finishReason: opts?.finishReason,
                ...(opts?.responseModel ? { model: opts.responseModel } : {}),
              },
            },
          });
        },
      });
      return makeRunnable();
    },
  };
  return model as unknown as BaseChatModel;
}

describe('LangchainStructuredExtractor', () => {
  it('returns the structured output and forwards system + human messages', async () => {
    let seen: any;
    const extractor = new LangchainStructuredExtractor(
      stubModel({
        onInvoke: (messages) => {
          seen = messages;
          return { value: 'hello' };
        },
      }),
      CFG,
    );

    const out = await extractor.extract({
      system: 'SYS',
      human: 'HUMAN',
      schema: SCHEMA,
    });

    expect(out).toEqual({ value: 'hello' });
    expect(seen).toHaveLength(2);
    expect(seen[0].content).toBe('SYS');
    expect(seen[1].content).toBe('HUMAN');
  });

  it('maps multimodal media parts to LangChain content blocks', async () => {
    let seen: any;
    const extractor = new LangchainStructuredExtractor(
      stubModel({ onInvoke: (m) => ((seen = m), { value: 'x' }) }),
      CFG,
    );

    await extractor.extract({
      system: 'SYS',
      human: [
        { type: 'text', text: 'caption' },
        { type: 'media', mimeType: 'application/pdf', dataBase64: 'AAA' },
      ],
      schema: SCHEMA,
    });

    expect(seen[1].content).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'media', mimeType: 'application/pdf', data: 'AAA' },
    ]);
  });

  it('applies provider-native retry when maxAttempts > 1', async () => {
    const captured: { retry?: number }[] = [];
    const extractor = new LangchainStructuredExtractor(
      stubModel({ capture: (e) => captured.push(e) }),
      CFG,
    );

    await extractor.extract({
      system: 'S',
      human: 'H',
      schema: SCHEMA,
      options: { maxAttempts: 3 },
    });

    expect(captured.some((c) => c.retry === 3)).toBe(true);
  });

  it('reports the response_metadata model when present, else the configured model', async () => {
    // Gemini omits `model` from response_metadata → fall back to the bound instance's model.
    const gemini = new LangchainStructuredExtractor(
      stubModel({ model: 'gemini-3.1-flash-lite' }),
      CFG,
    );
    let usage: { model: string | null } | undefined;
    await gemini.extract({
      system: 'S',
      human: 'H',
      schema: SCHEMA,
      options: { onUsage: (u) => (usage = u) },
    });
    expect(usage?.model).toBe('gemini-3.1-flash-lite');

    // When the response carries its own model (Anthropic), that wins.
    const anthropic = new LangchainStructuredExtractor(
      stubModel({ model: 'bound', responseModel: 'claude-haiku-4-5' }),
      CFG,
    );
    await anthropic.extract({
      system: 'S',
      human: 'H',
      schema: SCHEMA,
      options: { onUsage: (u) => (usage = u) },
    });
    expect(usage?.model).toBe('claude-haiku-4-5');
  });

  it('extractMany caps in-flight calls at the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const extractor = new LangchainStructuredExtractor(
      stubModel({
        onInvoke: async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
          return { value: 'ok' };
        },
      }),
      CFG,
    );

    const items = Array.from({ length: 6 }, (_, i) => i);
    const results = await extractor.extractMany(
      items,
      (i) => ({ system: 'S', human: `H${i}`, schema: SCHEMA }),
      { concurrency: 2 },
    );

    expect(results).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('warns when the system+human text exceeds the soft context budget', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const extractor = new LangchainStructuredExtractor(stubModel(), CFG);

    await extractor.extract({
      system: 'S'.repeat(400_001),
      human: 'H',
      schema: SCHEMA,
      options: { operation: 'test.oversized' },
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('test.oversized oversized'),
    );
    warn.mockRestore();
  });

  it('throws DocumentTooLargeError when the model truncates at MAX_TOKENS', async () => {
    const extractor = new LangchainStructuredExtractor(
      stubModel({ finishReason: 'MAX_TOKENS' }),
      CFG,
    );

    await expect(
      extractor.extract({ system: 'S', human: 'H', schema: SCHEMA }),
    ).rejects.toThrow(DocumentTooLargeError);
  });

  it('does not warn for a normal-size payload', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const extractor = new LangchainStructuredExtractor(stubModel(), CFG);

    await extractor.extract({ system: 'S', human: 'H', schema: SCHEMA });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
