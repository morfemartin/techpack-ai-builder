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
    const clipIds = []
    for (const item of FIXTURES) {
      const pages = buildPlannedPages(item.plan, ctxForFixture(item))
      expect(pages.length, item.id).toBeGreaterThan(0)
      for (const page of pages) {
        expect(page.svg, item.id).toContain("<svg")
        expect(page.svg, item.id).not.toMatch(/NaN|undefined/)
        clipIds.push(...[...page.svg.matchAll(/<clipPath id='([^']+)'/g)].map((match) => match[1]))
      }
    }
    expect(new Set(clipIds).size).toBe(clipIds.length)
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
    const decision = evaluatePageCompositions(result.page, ctx).decision
    expect(decision.mode).toBe("hero-rail")
    expect(decision.widths).toEqual([698, 414])
    expect(decision.complete).toBe(true)
  })

  it("per-slot fixture renders distinct structured briefs", () => {
    const item = fixture("K-per-slot-briefs")
    const [page] = buildPlannedPages(item.plan, ctxFor(DATASETS[item.dataset]), { documentMode: "illustration-handoff" })
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
    const results = [1, 6, 16, 24].map((count) => {
      const item = fixture("M-bom-" + count)
      return buildPlannedPages(item.plan, ctxForFixture(item), { documentMode: "illustration-handoff" })
    })
    expect(results.map((pages) => pages[0].compositionDecision.mode)).toEqual(["data-slot-mosaic", "data-slot-mosaic", "bom-hero", "bom-hero"])
    expect(results.every((pages) => pages[0].compositionDecision.complete)).toBe(true)
    expect(results[3]).toHaveLength(2)

    const short = fixture("B-split-stack")
    const shortPage = buildPlannedPages(short.plan, ctxForFixture(short), { documentMode: "illustration-handoff" })[0]
    expect(shortPage.compositionDecision.mode).toBe("data-slot-mosaic")
    expect(shortPage.compositionDecision.illustrationArea).toBeGreaterThan(600000)

    const fourViews = fixture("E-illustration-grid")
    const fourViewPage = buildPlannedPages(fourViews.plan, ctxForFixture(fourViews), { documentMode: "illustration-handoff" })[0]
    expect(fourViewPage.compositionDecision.mode).toBe("data-slot-mosaic")
    for (const view of [1, 2, 3, 4]) expect(fourViewPage.svg).toContain("id='ARTWORK__V" + view + "'")
    const artboards = [...fourViewPage.svg.matchAll(/<g id='ARTWORK__V\d+'><rect x='[\d.]+' y='([\d.]+)' width='[\d.]+' height='([\d.]+)'/g)]
    expect(artboards).toHaveLength(4)
    artboards.forEach((match) => {
      expect(Number(match[1]) % 16).toBe(0)
      expect(Number(match[2]) % 16).toBe(0)
    })

    const denseStops = fixture("N-stops-30")
    const decision = evaluatePageCompositions(denseStops.plan.pages[0], ctxForFixture(denseStops), { width: 1148, height: 674 }).decision
    expect(decision.valid).toBe(false)
    expect(decision.candidates.every((candidate) => !candidate.valid)).toBe(true)
    const pages = buildPlannedPages(denseStops.plan, ctxForFixture(denseStops), { documentMode: "illustration-handoff" })
    expect(pages).toHaveLength(2)
    const renderedStops = pages.flatMap((page) => [...page.svg.matchAll(/Stop (\d+):/g)].map((match) => Number(match[1])))
    expect(renderedStops).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
    pages.forEach((page) => {
      const contentTextY = [...page.svg.matchAll(/<text[^>]* y='([\d.]+)'[^>]*>([^<]*)<\/text>/g)]
        .filter((match) => !match[2].includes("ILLUSTRATION HANDOFF") && !/^P\. /.test(match[2]))
        .map((match) => Number(match[1]))
      expect(Math.max(...contentTextY)).toBeLessThanOrEqual(776)
    })
  })
})
