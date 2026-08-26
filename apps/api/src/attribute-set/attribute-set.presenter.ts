import type { AttributeSetDto } from '@nom/dtos';
import type { AttributeSet } from './attribute-set.types';

// Maps the internal attribute-set config to the render-facing DTO, dropping the
// extractor-only fields (promptContext, description). Reused by the source flows
// that embed attribute-set metadata in their responses.
export function toAttributeSetDto(set: AttributeSet): AttributeSetDto {
  return {
    key: set.key,
    label: set.label,
    documentType: set.documentType,
    attributes: set.attributes.map((a) => ({
      key: a.key,
      label: a.label,
      type: a.type,
      nullable: !!a.nullable,
    })),
  };
}
