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

describe("system titles name only the aspects a page actually contains", () => {
  it("does not title a plain t-shirt's neck page 'Capucha y cuello'", () => {
    // A crew-neck tee has a collar and no hood - the page used to be headed
    // "Capucha y cuello" regardless, naming a hood the garment lacks.
    const pages = partitionPartsBySystem([
      { id: "tela", label: "Tela principal", val: "Jersey de algodon", on: true },
      { id: "cuello", label: "Cuello", val: "Redondo rib", on: true },
      { id: "manga", label: "Manga", val: "Corta", on: true },
    ])
    const titles = pages.map((p) => p.title)
    expect(titles.some((t) => /Cuello/.test(t) && !/Capucha/.test(t))).toBe(true)
    expect(titles.some((t) => /Capucha/.test(t))).toBe(false)
    // and the sleeve page does not invent cuffs/armholes
    expect(titles.some((t) => /puno|sisa/i.test(t))).toBe(false)
  })

  it("names capucha and puno when the parts actually have them", () => {
    const pages = partitionPartsBySystem([
      { id: "capucha", label: "Capucha", val: "Con visera", on: true },
      { id: "manga", label: "Manga", val: "Con puno rib", on: true },
    ])
    const titles = pages.map((p) => p.title).join(" | ")
    expect(titles).toMatch(/Capucha/)
    expect(titles).toMatch(/Puno/)
  })

  it("keeps the stable Sistema NN production index", () => {
    const pages = partitionPartsBySystem([{ id: "cuello", label: "Cuello", val: "Redondo", on: true }])
    expect(pages.every((p) => /^Sistema \d\d · /.test(p.title))).toBe(true)
  })
})
