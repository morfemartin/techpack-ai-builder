import { describe, expect, it } from "vitest"
import { buildPlannedPages, interpretPagePlan } from "../pages/interpretPlan.js"
import { evaluatePageCompositions } from "../pages/composition.js"
import { repairPage, validatePage } from "../pages/pageContracts.js"
import { buildReviewFindings } from "../core/reviewDiff.js"
import { DATASETS, ctxFor } from "./datasets.js"
import { FIXTURES } from "./fixtures.js"
import { ctxForFixture } from "./fixtureContext.js"

function fixture(id) {
  return FIXTURES.find((item) => item.id === id)
}

describe("Layout Lab closure fixtures", () => {
  it("renders every deterministic fixture without invalid SVG geometry", () => {
    for (const item of FIXTURES) {
      const pages = buildPlannedPages(item.plan, ctxForFixture(item))
      expect(pages.length, item.id).toBeGreaterThan(0)
      for (const page of pages) {
        expect(page.svg, item.id).toContain("<svg")
        expect(page.svg, item.id).not.toMatch(/NaN|undefined/)
      }
    }
  })

  it("measure-pass renders its bounded BOM and illustration together", () => {
    const item = fixture("I-measure-pass")
    const [page] = buildPlannedPages(item.plan, ctxFor(DATASETS[item.dataset]))
    expect(page.svg).toContain("FRONT")
    expect(page.svg).toContain("Top triangular")
  })

  it("contract-repair fixture becomes clean and records repairs", () => {
    const item = fixture("J-contract-repair")
    const ctx = ctxFor(DATASETS[item.dataset])
    const result = repairPage(item.plan.pages[0], ctx)
    expect(result.repairs).toEqual(expect.arrayContaining(["dropped forbidden partsList", "inserted header", "inserted titleBar", "inserted illustration", "inserted disclaimer"]))
    expect(validatePage(result.page, ctx)).toEqual([])
    const root = interpretPagePlan(result.page, ctx)
    const workingArea = root.children[2]
    expect(workingArea.direction).toBe("row")
    expect(workingArea.children.every((child) => child.grow === 0)).toBe(true)
    const illustration = workingArea.children.find((child) => child._regionType === "illustration")
    const colors = workingArea.children.find((child) => child._regionType === "colorSpecs")
    const embroidery = workingArea.children.find((child) => child._regionType === "embSpecs")
    expect(illustration.basis).toBeGreaterThan(colors.basis)
    expect(illustration.basis).toBeGreaterThan(embroidery.basis)
    expect(colors.basis).toBeGreaterThanOrEqual(170)
    expect(embroidery.basis).toBeGreaterThanOrEqual(300)
  })

  it("per-slot fixture renders distinct structured briefs", () => {
    const item = fixture("K-per-slot-briefs")
    const [page] = buildPlannedPages(item.plan, ctxFor(DATASETS[item.dataset]))
    expect(page.svg).toContain("BACK PLACEMENT")
    expect(page.svg).toContain("SEAM CLOSE-UP")
    expect(page.svg).toContain("neck seam landmark")
    expect(page.svg).toContain("registration notch")
  })

  it("review-diff fixture exposes every omitted design", () => {
    const item = fixture("L-review-diff")
    const ctx = ctxFor(DATASETS[item.dataset])
    const findings = buildReviewFindings(ctx, item.plan)
    const unplacedDesigns = findings.filter((finding) => finding.kind === "unplaced" && finding.topic === "design")
    expect(unplacedDesigns.map((finding) => finding.field)).toEqual(ctx.designs.map((design) => design.name))
  })

  it("changes composition from measured density while preserving complete candidates", () => {
    const modes = [1, 6, 16, 24].map((count) => {
      const item = fixture("M-bom-" + count)
      return evaluatePageCompositions(item.plan.pages[0], ctxForFixture(item), { width: 1148, height: 674 }).decision
    })
    expect(modes.map((decision) => decision.mode)).toEqual(["stack", "stack", "row", "row"])
    expect(modes.every((decision) => decision.complete)).toBe(true)

    const denseStops = fixture("N-stops-30")
    const decision = evaluatePageCompositions(denseStops.plan.pages[0], ctxForFixture(denseStops), { width: 1148, height: 674 }).decision
    expect(decision.mode).toBe("row")
    expect(decision.complete).toBe(true)
    expect(decision.compressed).toBe(true)
  })
})
