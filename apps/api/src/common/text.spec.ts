import { mdToPlain } from './text';

describe('mdToPlain', () => {
  it('strips common Markdown formatting to plain text', () => {
    const md = [
      '# Towage',
      '',
      '**S$180.00** per _tug/hour_, minimum `2 hours`.',
      '',
      '- Origin charges',
      '- [Terms](https://example.com/terms)',
    ].join('\n');

    const out = mdToPlain(md);

    expect(out).toContain('Towage');
    expect(out).toContain('S$180.00');
    expect(out).toContain('tug/hour');
    expect(out).toContain('2 hours');
    expect(out).toContain('Origin charges');
    expect(out).toContain('Terms');
    // Formatting markers are gone.
    expect(out).not.toMatch(/[#`*_]/);
    expect(out).not.toContain('https://example.com/terms');
  });

  it('returns falsy input unchanged', () => {
    expect(mdToPlain('')).toBe('');
  });
});
