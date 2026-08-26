import { MetadataSchema, VendorMatchSchema } from './schemas';

// Reason-first field ordering: Zod field order = LLM generation order, so the
// scratch/reason field must precede the decision it explains.
describe('document extraction schemas', () => {
  it('emits classificationBasis before the classification decisions', () => {
    const keys = Object.keys(MetadataSchema.shape);
    expect(keys[0]).toBe('classificationBasis');
    expect(keys.indexOf('classificationBasis')).toBeLessThan(
      keys.indexOf('isFinancial'),
    );
  });

  it('emits typeMismatchReason before typeMismatch', () => {
    const keys = Object.keys(MetadataSchema.shape);
    expect(keys.indexOf('typeMismatchReason')).toBeLessThan(
      keys.indexOf('typeMismatch'),
    );
  });

  it('emits the vendor-match reason before the verdict', () => {
    const keys = Object.keys(VendorMatchSchema.shape);
    expect(keys.indexOf('reason')).toBeLessThan(keys.indexOf('isMatch'));
  });
});
