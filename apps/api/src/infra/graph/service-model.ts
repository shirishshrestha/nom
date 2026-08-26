import { SERVICE_MODELS } from '@nom/shared';
import type { ServiceModel } from '@nom/shared';

// Derive a canonical group's pricing model from data we already store: a group with
// any tier line is Tiered, otherwise Flat.
// ponytail: structural only (tier vs no-tier). The Free allowance / % of value
// branches are commented out — they were fragile pricingContext keyword sniffs.
// Restore them (and the SERVICE_MODELS entries) once real per-service model
// extraction exists.
export function deriveServiceModel(
  services: Array<{ tier: string | null; pricingContext: string }>,
): ServiceModel {
  if (services.some((s) => s.tier != null && s.tier !== ''))
    return SERVICE_MODELS.TIERED;

  // const ctx = services
  //   .map((s) => s.pricingContext ?? '')
  //   .join(' ')
  //   .toLowerCase();
  // if (ctx.includes('%') && ctx.includes('value'))
  //   return SERVICE_MODELS.PERCENT_OF_VALUE;
  // if (ctx.includes('free') || ctx.includes('allowance'))
  //   return SERVICE_MODELS.FREE_ALLOWANCE;

  return SERVICE_MODELS.FLAT;
}
