/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { jest } from '@jest/globals';
import { RULE_CATEGORIES } from '@nom/shared';
import { RulesService } from './rules.service';
import type { RuleForPrompt } from '../infra/graph/rule-graph.repository';

const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();
const CATEGORY = RULE_CATEGORIES.MATCHING_RECONCILIATION;

const rule = (id: string): RuleForPrompt => ({
  id,
  title: `t-${id}`,
  content: `c-${id}`,
});

function build() {
  const rules = {
    findForCategory: asyncFn(),
    searchRules: asyncFn(),
  } as any;
  const service = new RulesService({} as any, rules);
  return { service, rules };
}

describe('RulesService.rulesFor', () => {
  it('returns undefined when the vendor has no rules for the category', async () => {
    const { service, rules } = build();
    rules.findForCategory.mockResolvedValue([]);

    expect(
      await service.rulesFor('org-1', 'vendor-1', CATEGORY, 'ctx'),
    ).toBeUndefined();
    expect(rules.searchRules).not.toHaveBeenCalled();
  });

  it('injects all rules and skips the relevance search at or below the pinned core', async () => {
    const { service, rules } = build();
    const all = Array.from({ length: 10 }, (_, i) => rule(`r${i}`));
    rules.findForCategory.mockResolvedValue(all);

    const selected = await service.rulesFor(
      'org-1',
      'vendor-1',
      CATEGORY,
      'ctx',
    );

    expect(selected!.ruleIds).toEqual(all.map((r) => r.id));
    expect(rules.searchRules).not.toHaveBeenCalled();
  });

  it('always keeps the first 10 and adds only relevant overflow rules', async () => {
    const { service, rules } = build();
    // 12 rules: r0..r9 pinned core, r10/r11 overflow.
    const all = Array.from({ length: 12 }, (_, i) => rule(`r${i}`));
    rules.findForCategory.mockResolvedValue(all);
    // Relevance ranks r10 in but not r11 (and echoes a pinned one, which must be deduped).
    rules.searchRules.mockResolvedValue([rule('r10'), rule('r0')]);

    const selected = await service.rulesFor(
      'org-1',
      'vendor-1',
      CATEGORY,
      'ctx',
    );

    expect(selected!.ruleIds).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `r${i}`),
      'r10',
    ]);
    expect(selected!.ruleIds).not.toContain('r11');
  });
});
