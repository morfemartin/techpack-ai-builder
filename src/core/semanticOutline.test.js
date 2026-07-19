import { describe, expect, it } from "vitest"
import { alpineParkaBenchmark } from "../layoutLab/benchmarkProject.js"
import { auditSemanticCoverage, balancedChunks, buildSemanticDocumentPlan, buildSemanticOutline, classifyPartSystem, partitionPartsBySystem } from "./semanticOutline.js"

const context = { ...alpineParkaBenchmark, garmentType: alpineParkaBenchmark.label }

describe("semantic document architecture", () => {
  it("balances overflow instead of leaving a one-row continuation", () => {
    expect(balancedChunks([1, 2, 3, 4, 5, 6, 7, 8, 9], 8).map((page) => page.length)).toEqual([5, 4])
    expect(balancedChunks(Array.from({ length: 17 }), 8).map((page) => page.length)).toEqual([6, 6, 5])
  })

  it("uses explicit systems before token inference and has a deterministic fallback", () => {
    expect(classifyPartSystem({ id: "zip", system: "hood-neck" })).toBe("hood-neck")
    expect(classifyPartSystem({ id: "cargo-pocket" })).toBe("closures-pockets")
    expect(classifyPartSystem({ id: "unknown-component" })).toBe("shell-body")
  })

  it("partitions all 40 active pieces exactly once with a bounded page load", () => {
    const pages = partitionPartsBySystem(context.parts, { maxPartsPerPage: 8 })
    const ids = pages.flatMap((page) => page.pieces)
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
    expect(pages.every((page) => page.pieces.length <= 8)).toBe(true)
    expect(pages.map((page) => page.system)).toEqual([
      "shell-body",
      "hood-neck",
      "sleeves-cuffs",
      "closures-pockets",
      "lining-insulation",
      "trims-labels",
    ])
  })

  it("builds cover, six construction objectives and one page per design", () => {
    const outline = buildSemanticOutline(context)
    expect(outline.pages).toHaveLength(10)
    expect(outline.pages[0].purpose).toBe("cover")
    expect(outline.pages.filter((page) => page.purpose.startsWith("structure:"))).toHaveLength(6)
    expect(outline.pages.filter((page) => page.purpose.startsWith("design:"))).toHaveLength(3)
    expect(outline.pages.filter((page) => page.pieces).every((page) => page.objective && page.views.length === 2)).toBe(true)
  })

  it("creates a complete deterministic layout plan whose coverage audit is clean", () => {
    const plan = buildSemanticDocumentPlan(context)
    const audit = auditSemanticCoverage(plan, context.parts)
    expect(audit).toEqual({ covered: context.parts.map((part) => part.id), missing: [], duplicated: [] })
    for (const page of plan.pages.filter((item) => item.purpose.startsWith("structure:"))) {
      expect(page.regions.map((region) => region.type)).toEqual(["header", "titleBar", "partsList", "illustration", "disclaimer"])
      const illustration = page.regions.find((region) => region.type === "illustration")
      expect(illustration.briefs).toHaveLength(2)
      expect(illustration.briefs.every((brief) => brief.measurements.length === 0)).toBe(true)
    }
  })

  it("does not count a design placement reference as duplicate BOM coverage", () => {
    const plan = buildSemanticDocumentPlan(context)
    plan.pages.find((page) => page.purpose.startsWith("design:")).pieces = [context.parts[0].id]
    expect(auditSemanticCoverage(plan, context.parts).duplicated).toEqual([])
  })
})
