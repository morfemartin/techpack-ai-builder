import { describe, expect, it } from "vitest"
import { buildPlannedPages } from "../pages/interpretPlan.js"
import { repairPage, validatePage } from "../pages/pageContracts.js"
import { buildReviewFindings } from "../core/reviewDiff.js"
import { DATASETS, ctxFor } from "./datasets.js"
import { FIXTURES } from "./fixtures.js"

function fixture(id) {
  return FIXTURES.find((item) => item.id === id)
}

describe("Layout Lab closure fixtures", () => {
  it("renders every deterministic fixture without invalid SVG geometry", () => {
    for (const item of FIXTURES) {
      const pages = buildPlannedPages(item.plan, ctxFor(DATASETS[item.dataset]))
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
})
