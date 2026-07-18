import { describe, expect, it } from "vitest"
import { evaluatePageCompositions, optimizePageComposition, REGION_WIDTH_BANDS } from "./composition.js"

function page(purpose, dataRegions) {
  return {
    id: "p",
    purpose,
    regions: [
      { type: "header" },
      { type: "titleBar" },
      { type: "illustration", slots: 1 },
      ...dataRegions,
      { type: "disclaimer" },
    ],
  }
}

describe("constraint-driven page composition", () => {
  it("chooses a full-width illustration plus compact strip for a short BOM", () => {
    const input = page("overview", [{ type: "partsList" }])
    const ctx = { parts: [{ id: "body", val: "Cotton", on: true }] }
    const result = evaluatePageCompositions(input, ctx)

    expect(result.decision.mode).toBe("stack")
    expect(result.decision.complete).toBe(true)
    expect(result.page.regions.map((region) => region.type)).toEqual(["header", "titleBar", "illustration", "partsList", "disclaimer"])
  })

  it("chooses columns for a long BOM because stacking violates artwork height", () => {
    const input = page("overview", [{ type: "partsList" }])
    const ctx = { parts: Array.from({ length: 16 }, (_, index) => ({ id: "p" + index, val: "Spec", on: true })) }
    const result = evaluatePageCompositions(input, ctx)

    expect(result.decision.mode).toBe("row")
    expect(result.decision.complete).toBe(true)
    expect(result.decision.candidates.find((candidate) => candidate.mode === "stack").valid).toBe(false)
    const split = result.page.regions[2]
    expect(split.type).toBe("split")
    expect(split.regions.map((region) => region.type)).toEqual(["partsList", "illustration"])
    expect(split.regions[0]._columnWidth).toBeGreaterThanOrEqual(REGION_WIDTH_BANDS.partsList.min)
    expect(split.regions[1]._columnWidth).toBeGreaterThan(split.regions[0]._columnWidth)
  })

  it("chooses columns for dense design data without naming a garment or fixture", () => {
    const input = page("design:Artwork", [{ type: "colorSpecs" }, { type: "embSpecs" }])
    const ctx = {
      designs: [{
        name: "Artwork",
        colors: [{ hex: "#000000" }, { hex: "#FFFFFF" }, { hex: "#E11D3A" }],
        emb: { machine: "Tajima", stitches: "20000", stopSeq: Array.from({ length: 6 }, (_, index) => ({ stop: index + 1, name: "Color", stitches: 1000 })) },
      }],
    }
    const result = evaluatePageCompositions(input, ctx)
    const split = result.page.regions[2]

    expect(result.decision.mode).toBe("row")
    expect(result.decision.complete).toBe(true)
    expect(split.regions.map((region) => region.type)).toEqual(["illustration", "colorSpecs", "embSpecs"])
    expect(split.regions.find((region) => region.type === "colorSpecs")._columnWidth).toBeGreaterThanOrEqual(REGION_WIDTH_BANDS.colorSpecs.min)
    expect(split.regions.find((region) => region.type === "embSpecs")._columnWidth).toBeGreaterThanOrEqual(REGION_WIDTH_BANDS.embSpecs.min)
  })

  it("keeps a single short color card below a larger full-width illustration", () => {
    const input = page("design:Artwork", [{ type: "colorSpecs" }])
    const ctx = { designs: [{ name: "Artwork", colors: [{ hex: "#003DA5" }] }] }
    const result = evaluatePageCompositions(input, ctx)

    expect(result.decision.mode).toBe("stack")
    expect(result.decision.illustrationHeight).toBeGreaterThan(500)
  })

  it("does not mutate its input and leaves pages without competing data alone", () => {
    const input = page("cover", [])
    const before = JSON.stringify(input)
    const result = optimizePageComposition(input, {})
    expect(result).toBe(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it("counts compressed embroidery as complete while it stays above the legible floor", () => {
    const input = page("design:Artwork", [{ type: "colorSpecs" }, { type: "embSpecs" }])
    const ctx = { designs: [{
      name: "Artwork",
      colors: [{ hex: "#111111" }, { hex: "#FFFFFF" }, { hex: "#E11D3A" }],
      emb: { machine: "Tajima", stopSeq: Array.from({ length: 30 }, (_, index) => ({ stop: index + 1, name: "Thread", stitches: 1000 })) },
    }] }
    const result = evaluatePageCompositions(input, ctx)
    expect(result.decision.mode).toBe("row")
    expect(result.decision.complete).toBe(true)
    expect(result.decision.compressed).toBe(true)
    expect(result.decision.overflow).toBe(0)
  })
})
