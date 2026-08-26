import { toTable, toYaml } from './prompt-serialize';

describe('toTable', () => {
  it('renders a header row once and preserves key order', () => {
    const out = toTable([
      { id: 'L1', description: 'Ocean Freight', tier: '40ft' },
      { id: 'L2', description: 'Admin 5%', tier: null },
    ]);
    expect(out).toBe(
      'id | description | tier\nL1 | Ocean Freight | 40ft\nL2 | Admin 5% | —',
    );
  });

  it('drops a column that is null/empty on every row', () => {
    const out = toTable([
      { id: 'L1', note: null },
      { id: 'L2', note: undefined },
    ]);
    expect(out).toBe('id\nL1\nL2');
  });

  it('flattens nested objects and arrays into a single cell', () => {
    const out = toTable([
      { id: 'L1', attributes: { rate: 220, unit: 'teu' }, refs: ['a', 'b'] },
    ]);
    expect(out).toBe('id | attributes | refs\nL1 | rate=220, unit=teu | a, b');
  });

  it('returns a placeholder for an empty array', () => {
    expect(toTable([])).toBe('(none)');
  });
});

describe('toYaml', () => {
  it('renders scalar keys as key: value', () => {
    expect(toYaml({ canonicalName: 'ocean_freight', description: null })).toBe(
      'canonicalName: ocean_freight\ndescription: —',
    );
  });

  it('indents a nested object under its key', () => {
    const out = toYaml({
      canonicalName: 'ocean_freight',
      tier: { slug: '40ft', rate: 220 },
    });
    expect(out).toBe(
      'canonicalName: ocean_freight\ntier:\n  slug: 40ft\n  rate: 220',
    );
  });

  it('renders an array as a dashed list under its key', () => {
    const out = toYaml({ tiers: ['20ft', '40ft'] });
    expect(out).toBe('tiers:\n  - 20ft\n  - 40ft');
  });
});
