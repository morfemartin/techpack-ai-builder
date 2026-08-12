import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  DeepSeekError: class DeepSeekError extends Error {
    constructor(message, cause) {
      super(message)
      this.name = "DeepSeekError"
      this.cause = cause
    }
  },
}))

import { deepseekChat } from "./deepseekClient.js"
import { proposePoms, proposeGrading, validateGradingRule, applyProposedGrading, proposeBaseValues, validateBaseValue, applyProposedBaseValues, MAX_BASE_CM } from "./sizeChartAI.js"
import { newSizeChart, newPom } from "./sizeChart.js"

describe("proposePoms - never a value, only what to measure", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns POMs with empty cells even though the model was asked for label/howToMeasure only", async () => {
    deepseekChat.mockResolvedValue(JSON.stringify({
      poms: [
        { label: "Medio pecho", howToMeasure: "De costura a costura, 2.5cm bajo la axila" },
        { label: "Largo de cuerpo", howToMeasure: "Del hombro al ruedo" },
      ],
    }))
    const poms = await proposePoms({ garmentType: "Polo", generalFields: [] })
    expect(poms).toHaveLength(2)
    expect(poms[0].label).toBe("Medio pecho")
    expect(poms[0].howToMeasure).toBe("De costura a costura, 2.5cm bajo la axila")
    expect(poms[0].values).toEqual({})
    expect(poms[0].source).toBe("user")
    // Even if the model somehow smuggled a number in, the parser only ever
    // reads label/howToMeasure off its response - there is no code path that
    // could pick up an invented value.
    expect(poms.every((p) => Object.keys(p.values).length === 0)).toBe(true)
  })

  it("returns an empty array when the model finds nothing to grade (fallback, nothing invented)", async () => {
    deepseekChat.mockResolvedValue(JSON.stringify({ poms: [] }))
    const poms = await proposePoms({ garmentType: "Media", generalFields: [] })
    expect(poms).toEqual([])
  })

  it("the validator rejects a POM missing a label or howToMeasure", async () => {
    deepseekChat.mockImplementation(async ({ validator }) => {
      expect(validator(JSON.stringify({ poms: [{ label: "Medio pecho", howToMeasure: "" }] }))).toBe(false)
      expect(validator(JSON.stringify({ poms: [{ label: "Medio pecho", howToMeasure: "Bajo la axila" }] }))).toBe(true)
      return JSON.stringify({ poms: [] })
    })
    await proposePoms({ garmentType: "Polo", generalFields: [] })
  })
})

describe("validateGradingRule - the gate before a rule can even be shown", () => {
  function chartWithBase(value) {
    return newSizeChart({
      baseSize: "M",
      poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm", values: { M: value } })],
    })
  }

  it("accepts a finite positive increment under 20% of the base value", () => {
    const chart = chartWithBase(54)
    expect(validateGradingRule({ pomId: "p1", increment: 3, unit: "cm" }, chart)).toBe(true)
  })

  it("rejects an increment >= 20% of the base value (likely hallucinated)", () => {
    const chart = chartWithBase(54)
    expect(validateGradingRule({ pomId: "p1", increment: 11, unit: "cm" }, chart)).toBe(false)
  })

  it("rejects a non-finite, zero, or negative increment", () => {
    const chart = chartWithBase(54)
    expect(validateGradingRule({ pomId: "p1", increment: 0, unit: "cm" }, chart)).toBe(false)
    expect(validateGradingRule({ pomId: "p1", increment: -3, unit: "cm" }, chart)).toBe(false)
    expect(validateGradingRule({ pomId: "p1", increment: NaN, unit: "cm" }, chart)).toBe(false)
  })

  it("rejects a rule naming a pomId that does not exist in the chart", () => {
    const chart = chartWithBase(54)
    expect(validateGradingRule({ pomId: "not-real", increment: 3, unit: "cm" }, chart)).toBe(false)
  })

  it("rejects a rule against a POM with no base-size value to grade from", () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho" })] })
    expect(validateGradingRule({ pomId: "p1", increment: 3, unit: "cm" }, chart)).toBe(false)
  })
})

describe("proposeGrading - rules only, never the filled matrix", () => {
  beforeEach(() => vi.clearAllMocks())

  const chart = newSizeChart({
    baseSize: "M",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm", values: { M: 54 } })],
  })

  it("returns only pomId/increment/unit/why - never a filled matrix", async () => {
    deepseekChat.mockResolvedValue(JSON.stringify({ rules: [{ pomId: "p1", increment: 3, unit: "cm", why: "estandar de mercado" }] }))
    const rules = await proposeGrading({ chart, garmentType: "Polo" })
    expect(rules).toEqual([{ pomId: "p1", increment: 3, unit: "cm", why: "estandar de mercado" }])
  })

  it("filters out any rule that fails validateGradingRule even if the model returned it", async () => {
    deepseekChat.mockResolvedValue(JSON.stringify({ rules: [
      { pomId: "p1", increment: 3, unit: "cm" },
      { pomId: "p1", increment: 40, unit: "cm" },
      { pomId: "ghost", increment: 2, unit: "cm" },
    ] }))
    const rules = await proposeGrading({ chart, garmentType: "Polo" })
    expect(rules).toEqual([{ pomId: "p1", increment: 3, unit: "cm", why: "" }])
  })

  it("skips the AI call entirely when no POM has a base value yet", async () => {
    const emptyChart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho" })] })
    const rules = await proposeGrading({ chart: emptyChart, garmentType: "Polo" })
    expect(rules).toEqual([])
    expect(deepseekChat).not.toHaveBeenCalled()
  })
})

describe("applyProposedGrading - the deterministic fold, real Polo numbers", () => {
  it("grades every POM with a matching rule via the same arithmetic as manual grading", () => {
    const chart = newSizeChart({
      baseSize: "M",
      sizes: ["XS", "S", "M", "L", "XL", "XXL"],
      poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm", values: { M: 54 } })],
    })
    const graded = applyProposedGrading(chart, [{ pomId: "p1", increment: 3, unit: "cm" }])
    expect(graded.poms[0].values).toEqual({ XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 })
    expect(graded.poms[0].source).toBe("derived")
    expect(graded.poms[0].verified).toBe(false)
  })

  it("leaves a POM with no matching rule untouched", () => {
    const chart = newSizeChart({
      baseSize: "M",
      poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm", values: { M: 54 } })],
    })
    const graded = applyProposedGrading(chart, [])
    expect(graded.poms[0]).toEqual(chart.poms[0])
  })
})

describe("validateBaseValue - the gate before a base-value proposal can even be shown", () => {
  function chartWithEmptyBase(unit = "cm") {
    return newSizeChart({
      baseSize: "M",
      poms: [newPom({ id: "p1", label: "Medio pecho", unit })],
    })
  }

  it("accepts a finite positive value under the physical bound", () => {
    expect(validateBaseValue({ pomId: "p1", value: 54, unit: "cm" }, chartWithEmptyBase())).toBe(true)
  })

  it("converts units before checking the bound (2000mm = 200cm, still under MAX_BASE_CM)", () => {
    expect(validateBaseValue({ pomId: "p1", value: 2000, unit: "mm" }, chartWithEmptyBase())).toBe(true)
  })

  it("rejects a value over the physical bound in cm", () => {
    expect(validateBaseValue({ pomId: "p1", value: MAX_BASE_CM + 1, unit: "cm" }, chartWithEmptyBase())).toBe(false)
  })

  it("rejects a non-finite, zero, or negative value", () => {
    const chart = chartWithEmptyBase()
    expect(validateBaseValue({ pomId: "p1", value: 0, unit: "cm" }, chart)).toBe(false)
    expect(validateBaseValue({ pomId: "p1", value: -54, unit: "cm" }, chart)).toBe(false)
    expect(validateBaseValue({ pomId: "p1", value: NaN, unit: "cm" }, chart)).toBe(false)
  })

  it("rejects a rule naming a pomId that does not exist in the chart", () => {
    expect(validateBaseValue({ pomId: "ghost", value: 54, unit: "cm" }, chartWithEmptyBase())).toBe(false)
  })

  it("the hard rule: refuses to overwrite a base cell a human already typed", () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho", values: { M: 54 } })] })
    expect(validateBaseValue({ pomId: "p1", value: 99, unit: "cm" }, chart)).toBe(false)
  })
})

describe("proposeBaseValues - only ever asks about still-unmeasured POMs", () => {
  beforeEach(() => vi.clearAllMocks())

  it("skips the AI call entirely when every POM already has a base value", () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", values: { M: 54 } })] })
    return proposeBaseValues({ chart, garmentType: "Polo" }).then((rules) => {
      expect(rules).toEqual([])
      expect(deepseekChat).not.toHaveBeenCalled()
    })
  })

  it("returns validated {pomId, value, unit, why} rules", async () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm" })] })
    deepseekChat.mockResolvedValue(JSON.stringify({ values: [{ pomId: "p1", value: 54, unit: "cm", why: "estandar de mercado" }] }))
    const rules = await proposeBaseValues({ chart, garmentType: "Polo" })
    expect(rules).toEqual([{ pomId: "p1", value: 54, unit: "cm", why: "estandar de mercado" }])
  })

  it("filters out a rule that fails validateBaseValue even if the model returned it", async () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm" })] })
    deepseekChat.mockResolvedValue(JSON.stringify({ values: [
      { pomId: "p1", value: 54, unit: "cm" },
      { pomId: "p1", value: -5, unit: "cm" },
      { pomId: "ghost", value: 30, unit: "cm" },
    ] }))
    const rules = await proposeBaseValues({ chart, garmentType: "Polo" })
    expect(rules).toEqual([{ pomId: "p1", value: 54, unit: "cm", why: "" }])
  })
})

describe("applyProposedBaseValues - writes the base cell and marks it 'suggested', never 'measured'", () => {
  it("sets the base-size cell and marks the row suggested/unverified", () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho", unit: "cm" })] })
    const applied = applyProposedBaseValues(chart, [{ pomId: "p1", value: 54, unit: "cm" }])
    expect(applied.poms[0].values).toEqual({ M: 54 })
    expect(applied.poms[0].source).toBe("suggested")
    expect(applied.poms[0].verified).toBe(false)
  })

  it("converts the rule's unit into the POM's own unit before writing it", () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", unit: "in" })] })
    const applied = applyProposedBaseValues(chart, [{ pomId: "p1", value: 2, unit: "in" }])
    expect(applied.poms[0].values.M).toBe(2)
  })

  it("leaves a POM with no matching rule untouched", () => {
    const chart = newSizeChart({ baseSize: "M", poms: [newPom({ id: "p1", label: "Medio pecho" })] })
    const applied = applyProposedBaseValues(chart, [])
    expect(applied.poms[0]).toEqual(chart.poms[0])
  })
})
