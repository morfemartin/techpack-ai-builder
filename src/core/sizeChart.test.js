import { describe, it, expect } from "vitest"
import { DEFAULT_SIZES, newPom, newConstant, newSizeChart, normalizeSizeChart, hasSizeChartData, gradeFromBase, chartWarnings, sizesFromRangeText, seedSizesFromParts } from "./sizeChart.js"

describe("newPom / newSizeChart", () => {
  it("defaults to the standard size run and cm", () => {
    const chart = newSizeChart()
    expect(chart.sizes).toEqual(DEFAULT_SIZES)
    expect(chart.baseSize).toBe("M")
    expect(chart.poms).toEqual([])
  })

  it("a fresh pom is unverified and user-sourced", () => {
    const pom = newPom({ label: "Medio pecho" })
    expect(pom.source).toBe("user")
    expect(pom.verified).toBe(false)
    expect(pom.values).toEqual({})
  })

  it("accepts 'suggested' as a real source, and coerces any unknown string to 'user'", () => {
    expect(newPom({ source: "suggested" }).source).toBe("suggested")
    expect(newPom({ source: "derived" }).source).toBe("derived")
    expect(newPom({ source: "garbage" }).source).toBe("user")
    expect(newPom({}).source).toBe("user")
  })

  it("normalizeSizeChart tolerates a missing/malformed raw value", () => {
    expect(normalizeSizeChart(null).poms).toEqual([])
    expect(normalizeSizeChart(undefined).sizes).toEqual(DEFAULT_SIZES)
  })
})

describe("hasSizeChartData", () => {
  it("is false for an empty chart, true once a POM exists", () => {
    expect(hasSizeChartData(newSizeChart())).toBe(false)
    expect(hasSizeChartData(newSizeChart({ poms: [{ label: "Medio pecho" }] }))).toBe(true)
    expect(hasSizeChartData(null)).toBe(false)
  })
})

describe("gradeFromBase - the real Polo measurements", () => {
  // From the user's own production doc: Medio pecho 48/51/54/57/60/63 across
  // XS-XXL, base M=54, tolerance +-1.0cm, step +3cm per size.
  const sizes = ["XS", "S", "M", "L", "XL", "XXL"]

  it("grades outward in both directions from a base in the middle of the run", () => {
    const pom = newPom({ label: "Medio pecho", unit: "cm", values: { M: 54 }, tolerance: 1 })
    const graded = gradeFromBase(pom, { sizes, baseSize: "M", increment: 3, unit: "cm" })
    expect(graded.values).toEqual({ XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 })
  })

  it("marks a graded pom as derived and unverified - never looks confirmed", () => {
    const pom = newPom({ values: { M: 54 } })
    const graded = gradeFromBase(pom, { sizes, baseSize: "M", increment: 3, unit: "cm" })
    expect(graded.source).toBe("derived")
    expect(graded.verified).toBe(false)
  })

  it("matches the second real POM too (largo de cuerpo, +2cm step, base 72)", () => {
    const pom = newPom({ values: { M: 72 } })
    const graded = gradeFromBase(pom, { sizes, baseSize: "M", increment: 2, unit: "cm" })
    expect(graded.values).toEqual({ XS: 68, S: 70, M: 72, L: 74, XL: 76, XXL: 78 })
  })

  it("does nothing (returns the pom unchanged) when the base has no value yet", () => {
    const pom = newPom({ values: {} })
    const graded = gradeFromBase(pom, { sizes, baseSize: "M", increment: 3, unit: "cm" })
    expect(graded).toBe(pom)
  })

  it("converts the increment's unit into the pom's own unit before applying it", () => {
    const pom = newPom({ unit: "cm", values: { M: 54 } })
    const graded = gradeFromBase(pom, { sizes, baseSize: "M", increment: 30, unit: "mm" })
    expect(graded.values.L).toBe(57)
  })
})

describe("chartWarnings", () => {
  it("flags a pom with no base value, distinctly from empty non-base cells", () => {
    const chart = newSizeChart({ poms: [newPom({ id: "p1", label: "Sin base", values: { S: 51 } })] })
    expect(chartWarnings(chart)).toEqual([{ type: "missing-base", pomId: "p1", label: "Sin base" }])
  })

  it("flags empty cells once the base is present", () => {
    const chart = newSizeChart({ poms: [newPom({ id: "p1", label: "Medio pecho", values: { M: 54, L: 57 } })] })
    const warnings = chartWarnings(chart)
    expect(warnings).toEqual([{ type: "empty-cells", pomId: "p1", label: "Medio pecho", sizes: ["XS", "S", "XL", "XXL"] }])
  })

  it("flags a derived-but-unverified row even with every cell filled", () => {
    const full = { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 }
    const chart = newSizeChart({ poms: [newPom({ id: "p1", label: "Medio pecho", values: full, source: "derived", verified: false })] })
    expect(chartWarnings(chart)).toEqual([{ type: "unverified", pomId: "p1", label: "Medio pecho" }])
  })

  it("is silent for a complete, user-entered, or verified row", () => {
    const full = { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 }
    const chart = newSizeChart({ poms: [newPom({ label: "Medio pecho", values: full })] })
    expect(chartWarnings(chart)).toEqual([])
    const verified = newSizeChart({ poms: [newPom({ label: "Medio pecho", values: full, source: "derived", verified: true })] })
    expect(chartWarnings(verified)).toEqual([])
  })

  it("flags a suggested-but-unverified row with its own 'ai-base' type, distinct from 'unverified'", () => {
    const full = { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 }
    const chart = newSizeChart({ poms: [newPom({ id: "p1", label: "Medio pecho", values: full, source: "suggested", verified: false })] })
    expect(chartWarnings(chart)).toEqual([{ type: "ai-base", pomId: "p1", label: "Medio pecho" }])
  })
})

describe("sizesFromRangeText - never invents a size run it can't confidently read", () => {
  it("parses a slash-delimited list (cap.js's own 'Tallas' default)", () => {
    expect(sizesFromRangeText("S / M / L / XL")).toEqual({ sizes: ["S", "M", "L", "XL"], baseSize: "L" })
  })

  it("parses a comma-delimited list", () => {
    expect(sizesFromRangeText("S, M, L")).toEqual({ sizes: ["S", "M", "L"], baseSize: "M" })
  })

  it("parses a letter range with an explicit base ('S a XL, base M')", () => {
    expect(sizesFromRangeText("S a XL, base M")).toEqual({ sizes: ["S", "M", "L", "XL"], baseSize: "M" })
  })

  it("parses 'XS-XXL base M' (no comma before base)", () => {
    expect(sizesFromRangeText("XS-XXL base M")).toEqual({ sizes: DEFAULT_SIZES, baseSize: "M" })
  })

  it("parses an English/Spanish connector range without an explicit base, falling back to the middle size", () => {
    expect(sizesFromRangeText("S to XL")).toEqual({ sizes: ["S", "M", "L", "XL"], baseSize: "L" })
    expect(sizesFromRangeText("XS hasta XXL")).toEqual({ sizes: DEFAULT_SIZES, baseSize: "L" })
  })

  it("parses a numeric range on an even step ('36 a 44')", () => {
    expect(sizesFromRangeText("36 a 44")).toEqual({ sizes: ["36", "38", "40", "42", "44"], baseSize: "40" })
  })

  it("returns null for an odd numeric span it can't safely assume a step for", () => {
    expect(sizesFromRangeText("36 a 41")).toBeNull()
  })

  it("returns null for a genuinely ambiguous answer - never invents a size run", () => {
    expect(sizesFromRangeText("Talle unico")).toBeNull()
    expect(sizesFromRangeText("Prenda de referencia")).toBeNull()
    expect(sizesFromRangeText("")).toBeNull()
    expect(sizesFromRangeText(null)).toBeNull()
  })

  it("returns null when a delimited list has a token that isn't a real size", () => {
    expect(sizesFromRangeText("S / M / Custom")).toBeNull()
  })

  it("returns null for a reversed or single-size range", () => {
    expect(sizesFromRangeText("XL a S")).toBeNull()
    expect(sizesFromRangeText("M a M")).toBeNull()
  })
})

describe("seedSizesFromParts - only ever touches a pristine chart", () => {
  it("seeds sizes/baseSize from a matching part row", () => {
    const chart = newSizeChart()
    const parts = [{ label: "Tallas", val: "S / M / L / XL" }]
    expect(seedSizesFromParts(chart, parts)).toEqual({ ...chart, sizes: ["S", "M", "L", "XL"], baseSize: "L" })
  })

  it("matches the chat's 'Base de talles y medidas' answer too", () => {
    const chart = newSizeChart()
    const parts = [{ label: "Base de talles y medidas", val: "XS a XXL, base M" }]
    expect(seedSizesFromParts(chart, parts)).toEqual({ ...chart, sizes: DEFAULT_SIZES, baseSize: "M" })
  })

  it("never touches a chart that already has a POM", () => {
    const chart = newSizeChart({ poms: [newPom({ label: "Medio pecho" })] })
    const parts = [{ label: "Tallas", val: "S / M / L / XL" }]
    expect(seedSizesFromParts(chart, parts)).toEqual(normalizeSizeChart(chart))
  })

  it("never touches a chart whose base size or size run was already edited", () => {
    const editedBase = newSizeChart({ baseSize: "L" })
    expect(seedSizesFromParts(editedBase, [{ label: "Tallas", val: "S / M" }])).toEqual(editedBase)
    const editedSizes = newSizeChart({ sizes: ["S", "M", "L"] })
    expect(seedSizesFromParts(editedSizes, [{ label: "Tallas", val: "S / M" }])).toEqual(editedSizes)
  })

  it("leaves the chart unchanged when no part matches or the match doesn't parse", () => {
    const chart = newSizeChart()
    expect(seedSizesFromParts(chart, [{ label: "Tela", val: "100% algodon" }])).toEqual(chart)
    expect(seedSizesFromParts(chart, [{ label: "Tallas", val: "Talle unico" }])).toEqual(chart)
    expect(seedSizesFromParts(chart, [])).toEqual(chart)
    expect(seedSizesFromParts(chart, null)).toEqual(chart)
  })
})

describe("newConstant", () => {
  it("holds a single non-graded measurement", () => {
    const c = newConstant({ label: "Altura del cuello", value: 3.5, unit: "cm" })
    expect(c).toMatchObject({ label: "Altura del cuello", value: 3.5, unit: "cm" })
  })
})
