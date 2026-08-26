import { z } from 'zod';
import type { AttributeDef, AttributeSet } from './attribute-set.types';

// Single source of truth for an attribute set's machine + human shape. ONE walk
// over `set.attributes` produces both the Zod schema (LLM output contract) and
// the prompt lines (LLM instructions), so they can never drift apart.

function attrField(a: AttributeDef): z.ZodTypeAny {
  const base = a.type === 'number' ? z.number() : z.string();
  const field = a.nullable ? base.nullable() : base;
  return field.describe(a.description);
}

function attrLine(a: AttributeDef): string {
  return `   - "${a.key}" (${a.label}, ${a.type}${a.nullable ? ', nullable' : ''}): ${a.description}`;
}

export interface AttributesDescription {
  /** Zod object for the per-line attribute bag. */
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  /** Newline-joined instruction lines describing each attribute key. */
  promptLines: string;
}

export function describeAttributes(set: AttributeSet): AttributesDescription {
  const shape: Record<string, z.ZodTypeAny> = {};
  const lines: string[] = [];
  for (const a of set.attributes) {
    shape[a.key] = attrField(a);
    lines.push(attrLine(a));
  }
  return { schema: z.object(shape), promptLines: lines.join('\n') };
}
