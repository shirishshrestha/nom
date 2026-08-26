import { Injectable } from '@nestjs/common';
import type { DocumentType } from '@nom/shared';
import type { AttributeSet } from './attribute-set.types';

// ─── Attribute-set registry ──────────────────────────────────────────────────
// Single source of truth for every attribute set, shared by the documents
// (extraction + validation) and source (service extraction) features.

export const ATTRIBUTE_SETS: Record<string, AttributeSet> = {
  quotation: {
    key: 'quotation',
    documentType: 'source',
    label: 'Rate card',
    description:
      'A freight & logistics rate card or price quotation — a catalogue of physical services each priced per unit (e.g. per container, per shipment, per permit, per BL). Rates are flat amounts in currency, NOT a percentage of insured value, and there is no premium / sum insured / coverage / policy. No quantities billed.',
    promptContext:
      'You are a pricing data extractor for freight & logistics rate cards and quotations.',
    namingGuidance:
      'canonicalName examples: NOT "local_haulage_20ft" or "permit_fee_first_5"; just "local_haulage", "permit_declaration_fee". tierSlug examples: "20ft", "5_20_skus".',
    attributes: [
      {
        key: 'price',
        label: 'Price',
        type: 'number',
        description:
          "Numeric price only — no currency symbol, no commas. 'S$ 140.00' → 140.",
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description:
          "ISO 4217 code inferred from the symbol. 'S$'/'SGD' → 'SGD', 'US$' → 'USD'. Default 'SGD'.",
      },
      {
        key: 'unit',
        label: 'Unit',
        type: 'string',
        description:
          "Unit-of-measure phrase copied verbatim, e.g. 'per container unit', 'per permit', 'per shipment'.",
      },
      {
        key: 'remarks',
        label: 'Remarks',
        type: 'string',
        nullable: true,
        description:
          'Conditions, surcharges, or qualifiers that modify this line. Null if none.',
      },
    ],
    amountKeys: ['price'],
  },

  insurance: {
    key: 'insurance',
    documentType: 'source',
    label: 'Insurance',
    description:
      "An insurance policy, quote, cover note, endorsement agreement, policy amendment, or marine-cargo rate schedule — coverage lines defined by a premium / sum insured / coverage scope / policy period, where the rate is typically expressed as a PERCENTAGE of insured value (e.g. 0.04%, 0.10% of cargo value) and references things like marine voyages, storage cover, contingency/rejection cover, war/SRCC risks, or a policy/endorsement number. It stays insurance even when laid out as a 'schedule of rates' or written as a legal agreement. Not a billed invoice.",
    promptContext:
      "You are a data extractor for insurance policies and quotes. In insurance, 'premium' / 'premium rate' / 'premium adjustment' means the price/rate paid — NEVER a coverage type.",
    // Insurance rate cards restate the same cover across endorsements/renewals, so a reused
    // canonical + tier is what lets a new rate AMEND the old. Freight cards lack this
    // dynamic, so they fall back to the generic reuse rule (no reuseGuidance).
    reuseGuidance:
      "Vendors restate the same cover across endorsements, renewals, and schedule sections; when only the rate changed, reuse that cover's existing canonicalName + tierSlug so the new rate amends the old — minting a near-duplicate silently breaks the amendment chain. Mint a new name only when NO existing service is that cover.",
    namingGuidance:
      'The concept is the PERIL alone (ordinary / all-risks, war, SRCC, storage, contingency, rejection, take-over) — e.g. "ordinary_risks", "storage_cover", "contingency_cover" — never the voyage stage. A document that equates two peril wordings (e.g. "Ordinary risks (All Risks)") is naming ONE peril — never mint both an ordinary and an all-risks canonical for it. Coverage STAGE (main voyage vs FCL/LCL transshipment) and commodity are always tier BANDS, never in the name: the slug names the stage first, then the commodity CLASS at its coarsest grain when both split the rate (e.g. "main_voyage_foodstuffs", "main_voyage_empty_cartons", "transshipment") — never the full commodity enumeration.',
    attributes: [
      {
        key: 'premium',
        label: 'Premium',
        type: 'number',
        description:
          "Numeric premium / rate only — no currency symbol, no commas. For a rate written as a percentage, record the number exactly as it appears before the '%' sign ('0.04000%' → 0.04, '0.10%' → 0.10). Do NOT convert it to a decimal fraction (never 0.0004).",
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description:
          "ISO 4217 code inferred from the currency of the sum insured / limit or a rate's symbol. Default 'USD' when the document states no currency (e.g. rates given only as percentages).",
      },
      {
        key: 'coverage',
        label: 'Coverage',
        type: 'string',
        description:
          'Short description of what this line covers, copied/condensed from the source.',
      },
      {
        key: 'period',
        label: 'Period',
        type: 'string',
        description:
          "Coverage period or policy term, e.g. '01 Jan 2026 – 31 Dec 2026' or 'annual'.",
      },
      {
        key: 'deductible',
        label: 'Deductible',
        type: 'number',
        nullable: true,
        description: 'Numeric excess/deductible amount. Null if none stated.',
      },
      {
        key: 'remarks',
        label: 'Remarks',
        type: 'string',
        nullable: true,
        description: 'Conditions, exclusions, or qualifiers. Null if none.',
      },
    ],
    amountKeys: ['premium'],
  },

  invoice: {
    key: 'invoice',
    documentType: 'transaction',
    label: 'Invoice',
    description:
      'A billing invoice — line items each with a quantity and unit price that multiply to a billed amount, often with tax. Bills actual charges, not a catalogue.',
    promptContext:
      'You are a charge data extractor for freight & logistics invoices.',
    lineItemGuidance:
      'Tax: this vertical uses GST. A line is taxable when it carries a GST indicator — a "9% GST" line or a taxable "(T)" code; not taxable when out-of-scope "(OS)" or zero-rated. Set taxPercentage to the GST rate number (9 for "9% GST").\n' +
      'Formula shapes: a flat per-unit charge is "rate * quantity" (symbols [{rate, null}, {quantity, N}]); a single fixed charge is "rate" (symbols [{rate, null}]). A "(T)" code marks the line taxable, but its printed amount is NET (tax-exclusive) by DEFAULT — keep GST OUT of the formula and record it via taxable + taxPercentage. Append the tax factor "* (1 + gst)" (e.g. add {gst, 0.09}) ONLY when the line\'s own printed amount is explicitly the GST-inclusive total; "(T)" alone is NOT that case. Never mix bases.\n' +
      'Sibling references: an admin/handling fee billed as a percentage of OTHER charge lines (e.g. "Admin Charge 5% of PSA & Depot Handling") is a sibling_ref — name those other lines in initialRefSummary by their descriptions, and express its formula over its own symbols (e.g. "base * pct").',
    attributes: [
      {
        key: 'quantity',
        label: 'Qty',
        type: 'number',
        nullable: true,
        description:
          'Numeric quantity billed for this line. Null if not stated.',
      },
      {
        key: 'unit_price',
        label: 'Unit price',
        type: 'number',
        nullable: true,
        description:
          'Numeric price per unit only — no currency symbol, no commas. Null if not stated.',
      },
      {
        key: 'amount',
        label: 'Amount',
        type: 'number',
        description:
          'Numeric billed amount for this line (quantity × unit price) — no currency symbol, no commas.',
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: "ISO 4217 code inferred from the symbol. Default 'SGD'.",
      },
      {
        key: 'tax',
        label: 'Tax',
        type: 'string',
        nullable: true,
        description:
          "Tax/GST applied to this line, e.g. '9% GST'. Null if none.",
      },
      {
        key: 'remarks',
        label: 'Remarks',
        type: 'string',
        nullable: true,
        description: 'Conditions or notes that modify this line. Null if none.',
      },
    ],
    amountKeys: ['amount'],
  },

  endorsement: {
    key: 'endorsement',
    documentType: 'transaction',
    label: 'Endorsement',
    description:
      'An insurance invoice or policy endorsement — bills a premium or premium adjustment, referencing coverage/sum-insured/period rather than quantity × unit price.',
    promptContext:
      "You are a data extractor for insurance invoices and policy endorsements. In insurance, 'premium' / 'premium rate' / 'premium adjustment' means the price/rate paid — NEVER a coverage type; classify a cover by its PERIL (ordinary / all-risks, war, SRCC, storage, contingency, rejection, take-over), not by pricing words.",
    lineItemGuidance:
      'Tax: insurance premiums are typically not subject to GST — set taxable false unless the line carries an explicit tax indicator.\n' +
      'Formula shapes: when the contracted "rate" is a PERCENTAGE of the sum insured (common for insurance — e.g. a premium that is 0.05% of the insured value), keep "rate" as the percentage NUMBER (the rate card stores it as a percentage) and divide by 100: "sum_insured * rate / 100" (symbols [{sum_insured, N}, {rate, null}]). Do NOT treat the percentage as a direct decimal fraction. A premium adjustment or flat charge is "rate" (symbols [{rate, null}]).\n' +
      "Service disambiguation: cover descriptions often overlap (e.g. both mention ordinary risks / War) — decide by the billed percentage rate against each candidate tier's pricingContext; a line billed at 0.04% is the 0.04% service, not a textually-closer 0.10% one.",
    attributes: [
      {
        key: 'premium',
        label: 'Premium',
        type: 'number',
        description:
          'Numeric premium or adjustment amount only — no currency symbol, no commas.',
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: "ISO 4217 code inferred from the symbol. Default 'USD'.",
      },
      {
        key: 'sum_insured',
        label: 'Sum insured',
        type: 'number',
        nullable: true,
        description:
          'Numeric sum insured / coverage amount. Null if not stated.',
      },
      {
        key: 'coverage',
        label: 'Coverage',
        type: 'string',
        nullable: true,
        description:
          'Short description of what this line covers. Null if not stated.',
      },
      {
        key: 'period',
        label: 'Period',
        type: 'string',
        nullable: true,
        description:
          'Coverage period or policy term affected. Null if not stated.',
      },
      {
        key: 'amount',
        label: 'Amount',
        type: 'number',
        nullable: true,
        description:
          'Total billed amount for this line if distinct from the premium. Null if not stated.',
      },
      {
        key: 'remarks',
        label: 'Remarks',
        type: 'string',
        nullable: true,
        description: 'Conditions or notes that modify this line. Null if none.',
      },
    ],
    amountKeys: ['amount', 'premium'],
  },
};

// The billed/priced total to reconcile against: the first of the set's `amountKeys`
// whose attribute value is a finite number. Null when none is present (e.g. a line that
// prints only unit price + quantity). The seam the amount-reconciler reads.
export function resolveBilledAmount(
  set: AttributeSet,
  attributes: Record<string, string | number | null>,
): number | null {
  for (const key of set.amountKeys) {
    const value = attributes[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function attributeSetsFor(documentType: DocumentType): AttributeSet[] {
  return Object.values(ATTRIBUTE_SETS).filter(
    (s) => s.documentType === documentType,
  );
}

// Strict lookup — returns undefined for an unknown/legacy key (used by the
// financial hard-gate, which must NOT silently fall back to a default set).
export function getAttributeSet(
  key: string | null | undefined,
): AttributeSet | undefined {
  return key ? ATTRIBUTE_SETS[key] : undefined;
}

// Injectable façade over the registry so collaborators depend on an interface
// (DIP) and tests can substitute a fixture registry.
@Injectable()
export class AttributeSetRegistry {
  get(key: string | null | undefined): AttributeSet | undefined {
    return getAttributeSet(key);
  }

  forType(documentType: DocumentType): AttributeSet[] {
    return attributeSetsFor(documentType);
  }

  all(): Record<string, AttributeSet> {
    return ATTRIBUTE_SETS;
  }
}
