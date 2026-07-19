import { describe, expect, it } from "vitest"
import { GRID } from "../design/metrics.js"
import { evaluatePageCompositions, optimizePageComposition } from "./composition.js"
import { measureRegion } from "./measure.js"

function page(purpose, dataRegions, slots = 1) {
  return {
    id: "p",
    purpose,
    regions: [
      { type: "header" },
      { type: "titleBar" },
      { type: "illustration", slots },
      ...dataRegions,
      { type: "disclaimer" },
    ],
  }
}

describe("Layout Engine v3 candidate composition", () => {
  it("uses a bottom band for a short wide BOM", () => {
    const result = evaluatePageCompositions(page("overview", [{ type: "partsList" }]), { parts: [{ id: "body", val: "Cotton", on: true }] })
    expect(result.decision.mode).toBe("hero-bottom-band")
    expect(result.decision.complete).toBe(true)
    expect(result.ast.axis).toBe("column")
  })

  it("uses the 3/5 grid for a dense BOM beside artwork", () => {
    const ctx = { parts: Array.from({ length: 16 }, (_, index) => ({ id: "p" + index, val: "Spec", on: true })) }
    const result = evaluatePageCompositions(page("overview", [{ type: "partsList" }]), ctx)
    expect(result.decision.mode).toBe("bom-hero")
    expect(result.decision.widths).toEqual([GRID.span(3), GRID.span(5)])
    expect(result.decision.complete).toBe(true)
  })

  it("groups colors and embroidery in one rail instead of two half-empty columns", () => {
    const ctx = { designs: [{ name: "Artwork", colors: [{ hex: "#000000" }, { hex: "#FFFFFF" }, { hex: "#E11D3A" }], emb: { machine: "Tajima", stitches: "20000", stopSeq: [] } }] }
    const result = evaluatePageCompositions(page("design:Artwork", [{ type: "colorSpecs" }, { type: "embSpecs" }]), ctx)
    expect(result.decision.mode).toBe("hero-rail")
    expect(result.decision.widths).toEqual([GRID.span(5), GRID.span(3)])
    expect(result.ast.children[1].axis).toBe("column")
    expect(result.ast.children[1].children.map((node) => node.region.type)).toEqual(["embSpecs", "colorSpecs"])
  })

  it("keeps textile instructions inside artwork and out of the technical rail", () => {
    const input = page("design:Artwork", [{ type: "colorSpecs" }, { type: "embSpecs" }])
    input.regions[2].briefs = [{ view: "Front", mustMark: ["neck seam"], measurements: [{ label: "Width 70mm" }] }]
    const ctx = { documentMode: "illustration-handoff", designs: [{ name: "Artwork", colors: [{ hex: "#111111" }], emb: { machine: "Tajima", stopSeq: [] } }] }
    const result = evaluatePageCompositions(input, ctx)
    const railTypes = result.ast.children[1].children.map((node) => node.region.type)
    expect(result.decision.mode).toBe("hero-rail")
    expect(railTypes).toEqual(["embSpecs", "colorSpecs"])
    expect(result.decision.slotWidth).toBeGreaterThanOrEqual(240)
    expect(result.decision.slotHeight).toBeGreaterThanOrEqual(240)
  })

  it("uses a bottom band for one short color module", () => {
    const ctx = { designs: [{ name: "Artwork", colors: [{ hex: "#003DA5" }] }] }
    const result = evaluatePageCompositions(page("design:Artwork", [{ type: "colorSpecs" }]), ctx)
    expect(result.decision.mode).toBe("hero-bottom-band")
    expect(result.decision.slotValid).toBe(true)
  })

  it("reports overflow when a rail cannot fit at the legible floor", () => {
    const input = page("design:Artwork", [{ type: "colorSpecs" }, { type: "embSpecs" }])
    const ctx = { documentMode: "illustration-handoff", designs: [{ name: "Artwork", colors: Array.from({ length: 20 }, () => ({ hex: "#111111" })), emb: { machine: "Tajima", stopSeq: Array.from({ length: 40 }, (_, index) => ({ stop: index + 1, name: "Thread", stitches: 1000 })) } }] }
    const result = evaluatePageCompositions(input, ctx)
    expect(result.decision.candidates.some((candidate) => candidate.overflow > 0)).toBe(true)
  })

  it("compresses a rail to measured minimums instead of overflowing its box", () => {
    const input = page("design:Artwork", [{ type: "colorSpecs" }, { type: "embSpecs" }])
    input.regions[2].briefs = [{ view: "Front", mustMark: ["neck seam"], measurements: [{ label: "Width 70mm" }] }]
    const ctx = {
      documentMode: "illustration-handoff",
      designs: [{
        name: "Artwork",
        colors: [{ hex: "#111111" }, { hex: "#FFFFFF" }],
        emb: { machine: "Tajima", stopSeq: Array.from({ length: 10 }, (_, index) => ({ stop: index + 1, name: "Thread", stitches: 1000 })) },
      }],
    }
    const result = evaluatePageCompositions(input, ctx, { width: 1148, height: 628 })
    const rail = result.ast.children.find((child) => child.kind === "group" && child.axis === "column")
    const used = rail.children.reduce((sum, child) => sum + child.height, 0) + rail.gap * (rail.children.length - 1)
    expect(used).toBeLessThanOrEqual(628)
    rail.children.forEach((child) => {
      const measured = measureRegion(child.region, result.page, ctx, child.width)
      expect(child.height).toBeGreaterThanOrEqual(measured.min)
    })
  })

  it("does not mutate or compose a page without data competition", () => {
    const input = page("cover", [])
    const before = JSON.stringify(input)
    expect(optimizePageComposition(input, {})).toBe(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
