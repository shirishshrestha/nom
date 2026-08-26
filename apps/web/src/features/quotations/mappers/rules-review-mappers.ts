import { z } from "zod"
import type {
  AttributeSet,
  ReviewService,
  SaveServiceItem,
} from "@/features/quotations/types"

const baseServiceFormSchema = z
  .object({
    title: z.string().trim().min(1, "This field is required"),
    pricingContext: z.string().trim().min(1, "This field is required"),
  })
  .catchall(z.union([z.string(), z.number(), z.null()]))

export type ServiceFormValues = z.infer<typeof baseServiceFormSchema>

/**
 * Uses `superRefine` on a static base (rather than building a whole ZodObject
 * at runtime) to keep the inferred type stable so zodResolver doesn't need a
 * cast.
 */
export function buildServiceFormSchema(attributeSet: AttributeSet) {
  return baseServiceFormSchema.superRefine((data, ctx) => {
    for (const attr of attributeSet.attributes) {
      const v = data[attr.key]
      if (!attr.nullable && (v === null || v === "" || v === undefined)) {
        ctx.addIssue({
          code: "custom",
          message: "This field is required",
          path: [attr.key],
        })
      }
    }
  })
}

/** Null attribute values become "" so they bind to controlled inputs. */
export function serviceToFormValues(
  service: ReviewService,
  attributeSet: AttributeSet
): ServiceFormValues {
  const values: ServiceFormValues = {
    title: service.title,
    pricingContext: service.pricingContext,
  }
  for (const attr of attributeSet.attributes) {
    const raw = service.attributes[attr.key]
    values[attr.key] = raw ?? ""
  }
  return values
}

/** Empty strings on nullable attributes collapse to null on save. */
export function formValuesToSaveItem(
  serviceId: string,
  values: ServiceFormValues,
  attributeSet: AttributeSet
): SaveServiceItem {
  const attributes: Record<string, string | number | null> = {}
  for (const attr of attributeSet.attributes) {
    const v = values[attr.key]
    attributes[attr.key] = v === "" ? null : v
  }
  return {
    id: serviceId,
    attributes,
    title: values.title,
    pricingContext: values.pricingContext,
  }
}
