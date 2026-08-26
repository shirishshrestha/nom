import { describe, expect, it } from "vitest"
import {
  formatAttrValue,
  groupTitle,
  mapGroupedServicesToQuotations,
} from "@/features/quotations/mappers/quotations-mappers"
import type {
  CurrentService,
  CurrentServiceGroup,
} from "@/features/quotations/types"

function service(over: Partial<CurrentService>): CurrentService {
  return {
    id: "1",
    canonicalName: "svc",
    canonicalDescription: null,
    category: null,
    title: "Service",
    tier: null,
    tierSlug: null,
    pricingContext: "",
    model: "Flat",
    attributes: { price: 10, currency: "SGD", unit: "per unit" },
    validFrom: null,
    validTo: null,
    ...over,
  }
}

describe("formatAttrValue", () => {
  it("formats numbers with locale grouping", () => {
    expect(formatAttrValue(1500, "number")).toBe((1500).toLocaleString())
  })
  it("preserves precision beyond 3 decimals instead of rounding to zero", () => {
    expect(formatAttrValue(0.0004, "number")).toBe("0.0004")
    expect(formatAttrValue(0.12345, "number")).toBe("0.12345")
  })
  it("renders strings verbatim", () => {
    expect(formatAttrValue("per container unit", "string")).toBe(
      "per container unit"
    )
  })
  it("shows a dash for null or empty", () => {
    expect(formatAttrValue(null, "number")).toBe("—")
    expect(formatAttrValue("", "string")).toBe("—")
  })
})

describe("groupTitle", () => {
  it("strips the inline tier suffix from tiered titles", () => {
    expect(
      groupTitle(service({ tier: "20ft", title: "Local haulage - 20ft" }))
    ).toBe("Local haulage")
    expect(
      groupTitle(
        service({ tier: "Weekdays", title: "Overtime rates: Weekdays" })
      )
    ).toBe("Overtime rates")
  })
  it("keeps a singleton title verbatim (legit parens survive)", () => {
    expect(
      groupTitle(
        service({ tier: null, title: "Chiller (+2 to +8 deg) monthly rate" })
      )
    ).toBe("Chiller (+2 to +8 deg) monthly rate")
  })
})

function group(over: Partial<CurrentServiceGroup>): CurrentServiceGroup {
  return {
    canonicalName: "svc",
    canonicalDescription: null,
    category: null,
    services: [service({})],
    ...over,
  }
}

describe("mapGroupedServicesToQuotations", () => {
  it("maps each pre-grouped canonical group to one row with a tier per service", () => {
    const rows = mapGroupedServicesToQuotations([
      group({
        canonicalName: "local_haulage",
        services: [
          service({
            id: "a",
            canonicalName: "local_haulage",
            title: "Local haulage - 20ft",
            tier: "20ft",
            pricingContext: "Sunday surcharge",
            attributes: {
              price: 150,
              currency: "SGD",
              unit: "per container unit",
            },
          }),
          service({
            id: "b",
            canonicalName: "local_haulage",
            title: "Local haulage - 40ft",
            tier: "40ft",
            attributes: {
              price: 220,
              currency: "SGD",
              unit: "per container unit",
            },
          }),
        ],
      }),
      group({
        canonicalName: "courier_fee",
        services: [
          service({
            id: "c",
            canonicalName: "courier_fee",
            title: "Courier fee",
          }),
        ],
      }),
    ])

    expect(rows).toHaveLength(2)
    const haulage = rows[0]
    expect(haulage.code).toBe("local_haulage")
    expect(haulage.title).toBe("Local haulage")
    expect(haulage.conditions).toBe("Sunday surcharge")
    expect(haulage.tiers).toEqual([
      {
        id: "a",
        label: "20ft",
        attributes: { price: 150, currency: "SGD", unit: "per container unit" },
      },
      {
        id: "b",
        label: "40ft",
        attributes: { price: 220, currency: "SGD", unit: "per container unit" },
      },
    ])
    expect(rows[1].tiers[0].label).toBeUndefined()
  })
})
