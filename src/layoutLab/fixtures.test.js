import { describe, expect, it } from "vitest"
import { buildPlannedPages, interpretPagePlan } from "../pages/interpretPlan.js"
import { evaluatePageCompositions } from "../pages/composition.js"
import { repairPage, validatePage } from "../pages/pageContracts.js"
import { buildReviewFindings } from "../core/reviewDiff.js"
import { auditSemanticCoverage } from "../core/semanticOutline.js"
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
      const pages = buildPlannedPages(item.plan, ctxForFixture(item), { includeIndex: !!item.includeIndex, documentMode: "illustration-handoff" })
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

  it("keeps the pagination fixture above real compact-table capacity", () => {
    const item = fixture("F-pagination")
    const pages = buildPlannedPages(item.plan, ctxForFixture(item), { documentMode: "illustration-handoff" })
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[1].name).toContain("cont")
    expect(pages[0].compositionDecision.valid).toBe(true)
    expect(pages[0].compositionDecision.slotWidth).toBeGreaterThanOrEqual(320)
    const rowCounts = []
    pages.forEach((page) => {
      const bom = page.svg.match(/<g id='TECH_DATA__BOM'>(.*?)<\/g>/s)[1]
      const rows = [...bom.matchAll(/<rect x='[\d.]+' y='([\d.]+)' width='[\d.]+' height='([\d.]+)' fill='#(?:FFFFFF|F7F7F8)'/g)]
      rowCounts.push(rows.length)
      const last = rows[rows.length - 1]
      expect(Number(last[1]) + Number(last[2])).toBe(768)
    })
    expect(rowCounts.reduce((sum, count) => sum + count, 0)).toBe(40)
    pages.forEach((page) => expect(page.svg).toContain("id='ARTWORK'"))
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

  it("renders the complete semantic benchmark with index, exact coverage and structured handoff", () => {
    const item = fixture("O-complete-semantic-project")
    const ctx = ctxForFixture(item)
    const audit = auditSemanticCoverage(item.plan, ctx.parts)
    expect(audit.missing).toEqual([])
    expect(audit.duplicated).toEqual([])
    expect(audit.covered).toHaveLength(40)

    const pages = buildPlannedPages(item.plan, ctx, { includeIndex: true, documentMode: "illustration-handoff" })
    expect(pages).toHaveLength(11)
    expect(pages.map((page) => page.pageNumber)).toEqual(Array.from({ length: 11 }, (_, index) => index + 1))
    expect(pages.every((page) => page.totalPages === 11)).toBe(true)
    expect(pages[0].svg).not.toContain("INDICE DE PRODUCCION")
    expect(pages[1].purpose).toBe("index")
    expect(pages[1].svg).toContain("INDICE")
    expect(pages[1].svg).toContain("Sistema 01")
    expect(pages[1].svg).toContain("D1")
    expect(pages[1].svg).toContain("QUE CONTIENE / PARA QUE SIRVE")

    const structurePages = pages.filter((page) => page.purpose.startsWith("structure:"))
    expect(structurePages).toHaveLength(6)
    structurePages.forEach((page) => {
      expect(page.svg).toContain("id='TECH_DATA__BOM'")
      expect(page.svg).toContain("id='ILLUSTRATOR_INSTRUCTIONS__V1'")
      expect(page.svg).toContain("id='ILLUSTRATOR_INSTRUCTIONS__V2'")
      expect(page.svg).not.toMatch(/NaN|undefined/)
    })
    const logoSvg = pages.find((page) => page.purpose === "design:Logo pecho reflectivo").svg
    expect(logoSvg).toContain("DIM-1 Ancho 68 x")
    expect(logoSvg).toContain("alto 22")
  })

  it("changes composition from measured density while preserving complete candidates", () => {
    const results = [1, 6, 16, 24].map((count) => {
      const item = fixture("M-bom-" + count)
      return buildPlannedPages(item.plan, ctxForFixture(item), { documentMode: "illustration-handoff" })
    })
    expect(results.map((pages) => pages[0].compositionDecision.mode)).toEqual(["hero-bottom-band", "hero-bottom-band", "bom-hero", "bom-hero"])
    expect(results.every((pages) => pages[0].compositionDecision.complete)).toBe(true)
    expect(results[3]).toHaveLength(1)
    expect(results[2][0].compositionDecision.slotWidth).toBe(414)
    expect(results[2][0].compositionDecision.slotHeight).toBe(608)
    expect(results[2][0].compositionDecision.widths).toEqual([272, 840])
    expect(results[2][0].compositionDecision.smallestIllustrationArea).toBe(414 * 608)
    const bomMarkup = results[2][0].svg.match(/<g id='TECH_DATA__BOM'>(.*?)<\/g>/s)[1]
    const bomRows = [...bomMarkup.matchAll(/<rect x='[\d.]+' y='([\d.]+)' width='[\d.]+' height='([\d.]+)' fill='#(?:FFFFFF|F7F7F8)'/g)]
    const lastBomRow = bomRows[bomRows.length - 1]
    expect(Number(lastBomRow[1]) + Number(lastBomRow[2])).toBe(768)
    expect(results[3][0].compositionDecision.slotWidth).toBeGreaterThanOrEqual(240)
    expect(results[3][0].compositionDecision.slotHeight).toBeGreaterThanOrEqual(240)
    expect(results[3][0].compositionDecision.widths).toEqual([414, 698])

    const fullDocument = fixture("H-full-document")
    const overview = buildPlannedPages(fullDocument.plan, ctxForFixture(fullDocument), { documentMode: "illustration-handoff" })[0]
    expect(overview.compositionDecision.mode).toBe("hero-bottom-band")
    expect(overview.compositionDecision.unusedPageArea).toBe(0)

    const short = fixture("B-split-stack")
    const shortPage = buildPlannedPages(short.plan, ctxForFixture(short), { documentMode: "illustration-handoff" })[0]
    expect(shortPage.compositionDecision.mode).toBe("hero-bottom-band")
    expect(shortPage.compositionDecision.unusedPageArea).toBe(0)
    expect(shortPage.compositionDecision.illustrationArea).toBeGreaterThan(600000)

    const fourViews = fixture("E-illustration-grid")
    const fourViewPage = buildPlannedPages(fourViews.plan, ctxForFixture(fourViews), { documentMode: "illustration-handoff" })[0]
    expect(fourViewPage.compositionDecision.mode).toBe("hero-bottom-band")
    expect(fourViewPage.compositionDecision.heights).toEqual([512, 80])
    expect(fourViewPage.compositionDecision.smallestIllustrationArea).toBe(556 * 248)
    for (const view of [1, 2, 3, 4]) {
      expect(fourViewPage.svg).toContain("ARTBOARD_CONTENT_CLIP__V" + view)
      expect(fourViewPage.svg).toContain("id='ILLUSTRATOR_INSTRUCTIONS__V" + view + "'")
    }
    const artboards = [...fourViewPage.svg.matchAll(/<rect x='[\d.]+' y='([\d.]+)' width='[\d.]+' height='([\d.]+)' fill='none' stroke='#E4E6EA'/g)]
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
    expect(pages).toHaveLength(3)
    const renderedStops = pages.flatMap((page) => [...page.svg.matchAll(/Stop (\d+):/g)].map((match) => Number(match[1])))
    expect(renderedStops).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
    expect(pages[0].svg).toContain("id='TECH_DATA__COLORS'")
    expect(pages[0].svg).not.toContain("id='TECH_DATA__EMBROIDERY'")
    pages.slice(1).forEach((page) => expect(page.svg).toContain("id='ARTWORK'"))
    pages.forEach((page) => {
      const contentTextY = [...page.svg.matchAll(/<text[^>]* y='([\d.]+)'[^>]*>([^<]*)<\/text>/g)]
        .filter((match) => !/^P\. /.test(match[2]) && !/^V\d+\//.test(match[2]) && !match[2].includes("TODOS LOS DERECHOS"))
        .map((match) => Number(match[1]))
      expect(Math.max(...contentTextY)).toBeLessThanOrEqual(776)
    })
  })
})
