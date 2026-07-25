import { describe, expect, it } from "vitest"
import { ambiguousGarmentTerm } from "./garmentLexicon.js"
import { classifyGarmentFamily } from "./garmentAnatomy.js"

describe("ambiguousGarmentTerm", () => {
  it("flags bare 'franela' as ambiguous with two resolved options", () => {
    const result = ambiguousGarmentTerm("franela")
    expect(result).not.toBeNull()
    expect(result.question).toMatch(/franela/i)
    expect(result.options).toHaveLength(2)
    expect(result.options.map((o) => o.resolvedType)).toEqual([
      "Camiseta de punto (tipo franela)",
      "Camisa de franela (tejido de trama, tipo leñador)",
    ])
  })

  it("is accent/case insensitive and matches inside a longer phrase", () => {
    expect(ambiguousGarmentTerm("Franela")).not.toBeNull()
    expect(ambiguousGarmentTerm("una franela negra")).not.toBeNull()
  })

  it("does not flag unambiguous regionalisms for the same garment", () => {
    // remera/playera/polera are just synonyms for a t-shirt, not a second
    // unrelated meaning - they need no disambiguation question.
    expect(ambiguousGarmentTerm("remera")).toBeNull()
    expect(ambiguousGarmentTerm("playera")).toBeNull()
    expect(ambiguousGarmentTerm("polera")).toBeNull()
    expect(ambiguousGarmentTerm("camiseta")).toBeNull()
  })

  it("returns null for empty/unrelated input", () => {
    expect(ambiguousGarmentTerm("")).toBeNull()
    expect(ambiguousGarmentTerm(undefined)).toBeNull()
    expect(ambiguousGarmentTerm("hoodie")).toBeNull()
  })

  it("each resolved option feeds classifyGarmentFamily into the family the label actually promises", () => {
    const result = ambiguousGarmentTerm("franela")
    const [tee, shirt] = result.options
    expect(classifyGarmentFamily(tee.resolvedType)).toBe("tee")
    expect(classifyGarmentFamily(shirt.resolvedType)).toBe("shirt")
  })

  it("translates the question/option labels the user reads when uiLang is EN", () => {
    const result = ambiguousGarmentTerm("franela", "EN")
    expect(result.question).toMatch(/franela/i)
    expect(result.question).not.toMatch(/referís/i)
    expect(result.options.map((o) => o.label)).toEqual(["Knit t-shirt (remera/tee)", "Flannel shirt (woven, lumberjack-style)"])
  })

  it("keeps resolvedType in Spanish regardless of uiLang - it feeds the AI prompt and classifyGarmentFamily, not the screen", () => {
    const es = ambiguousGarmentTerm("franela", "ES")
    const en = ambiguousGarmentTerm("franela", "EN")
    expect(en.options.map((o) => o.resolvedType)).toEqual(es.options.map((o) => o.resolvedType))
    // Still classifies correctly even when the user is in the EN UI.
    expect(classifyGarmentFamily(en.options[0].resolvedType)).toBe("tee")
    expect(classifyGarmentFamily(en.options[1].resolvedType)).toBe("shirt")
  })
})
