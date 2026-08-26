import { promptTag, type PromptTemplate } from './prompt.types';
import { EXTRACTION_PROMPT } from '../../documents/attribute-sets';
import { VENDOR_MATCH_TEMPLATE } from '../../documents/helpers/vendor-match';
import { SERVICE_EXTRACT_PROMPT } from '../../source/service-schema';
import { ATTRIBUTE_SETS } from '../../attribute-set';

describe('prompt templates', () => {
  it('promptTag combines id + version', () => {
    const t: PromptTemplate<void> = {
      id: 'x.y',
      version: 'v1',
      render: () => '',
    };
    expect(promptTag(t)).toBe('x.y@v1');
  });

  it('every prompt has a stable id + version and renders non-empty text', () => {
    expect(EXTRACTION_PROMPT.id).toBe('document.extract');
    expect(EXTRACTION_PROMPT.version).toBeTruthy();
    expect(EXTRACTION_PROMPT.render('source')).toContain(
      'document preprocessor',
    );

    expect(VENDOR_MATCH_TEMPLATE.id).toBe('vendor.match');
    expect(VENDOR_MATCH_TEMPLATE.render()).toContain('registered vendor');

    expect(SERVICE_EXTRACT_PROMPT.id).toBe('service.extract');
    const prompt = SERVICE_EXTRACT_PROMPT.render({
      set: ATTRIBUTE_SETS.quotation,
      runningCanonicals: [],
      runningTiers: [],
      metadata: { isFinancial: false, attributeSet: null },
    });
    expect(prompt).toContain('priced service line');
  });
});
