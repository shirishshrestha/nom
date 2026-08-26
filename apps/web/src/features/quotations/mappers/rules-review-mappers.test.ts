import { describe, expect, it } from "vitest"
import {
  buildServiceFormSchema,
  formValuesToSaveItem,
  serviceToFormValues,
} from "@/features/quotations/mappers/rules-review-mappers"
import type { AttributeSet, ReviewService } from "@/features/quotations/types"

const attributeSet: AttributeSet = {
  key: "quotation",
  label: "Rate card",
  documentType: "source",
  attributes: [
    { key: "price", label: "Price", type: "number", nullable: false },
    { key: "unit", label: "Unit", type: "string", nullable: false },
    { key: "remarks", label: "Remarks", type: "string", nullable: true },
  ],
}

function service(over: Partial<ReviewService>): ReviewService {
  return {
    id: "s1",
    title: "Local haulage",
    category: null,
    tier: null,
    pricingContext: "Sunday surcharge",
    attributes: { price: 150, unit: "per container", remarks: null },
    meta: {
      foundAt: null,
      sourceText: "150 per container",
      contentId: "c1",
      sectionLabel: "Haulage",
      position: 0,
    },
    log: "",
    ...over,
  }
}

describe("buildServiceFormSchema", () => {
  const schema = buildServiceFormSchema(attributeSet)

  it("accepts valid values and requires title/pricingContext", () => {
    const parsed = schema.parse({
      title: "X",
      pricingContext: "Y",
      price: 150,
      unit: "per container",
      remarks: null,
    })
    expect(parsed.price).toBe(150)
  })

  it("rejects an empty required field", () => {
    expect(() =>
      schema.parse({
        title: "",
        pricingContext: "Y",
        price: 1,
        unit: "u",
        remarks: null,
      })
    ).toThrow()
  })
})

describe("serviceToFormValues", () => {
  it("maps null attribute values to empty string", () => {
    const v = serviceToFormValues(service({}), attributeSet)
    expect(v).toMatchObject({ title: "Local haulage", price: 150, remarks: "" })
  })
})

describe("formValuesToSaveItem", () => {
  it("collapses empty strings back to null and keeps title/pricingContext", () => {
    const item = formValuesToSaveItem(
      "s1",
      {
        title: "T",
        pricingContext: "P",
        price: 200,
        unit: "per pallet",
        remarks: "",
      },
      attributeSet
    )
    expect(item).toEqual({
      id: "s1",
      title: "T",
      pricingContext: "P",
      attributes: { price: 200, unit: "per pallet", remarks: null },
    })
  })
})
