import { describe, it, expect } from "vitest"
import { buildPage1, renderColorSpecs, renderEmbSpecs, renderIllustrationZone, renderPartsList } from "./buildPages.js"
import { capGarment } from "../garments/cap.js"
import { GENERIC_SILHOUETTE } from "../garments/genericSilhouette.js"

// These assert the exact geometry the old hand-computed pixel math produced
// (hH=80, detailsBar=22, tableHeader=20, discH=20 on an 1200x900 page -> a
// body row of 778px, spec-table rows sharing 778-20=758px), so the switch
// to the flexbox-style engine in buildPage1 is provably a like-for-like
// layout, not just "it still builds."
describe("buildPage1 layout parity", () => {
  const hdr = { brand: "Test Brand", season: "2027 SS", sno: "T001", cat: "Cap", fab: "Poly", fac: "", ind: "", outd: "", pname: "Test Cap" }

  function rects(svg) {
    return [...svg.matchAll(/<rect x='([\d.]+)' y='([\d.]+)' width='([\d.]+)' height='([\d.]+)'/g)].map((m) => m.slice(1).map(Number))
  }

  it("keeps the header at the top spanning the full width, 80px tall", () => {
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    // svgHeader's own logo block is the first rect it draws: x=0,y=0,w=88,h=80
    const found = rects(svg).find(([x, y, w, h]) => x === 0 && y === 0 && w === 88 && h === 80)
    expect(found).toBeTruthy()
  })

  it("positions the DETAILS bar right below the header, full width, 22px tall", () => {
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    expect(rects(svg)).toContainEqual([0, 80, 1200, 22])
  })

  it("keeps the disclaimer bar at the bottom, full width, 20px tall", () => {
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    expect(rects(svg)).toContainEqual([0, 880, 1200, 20])
  })

  it("draws the spec-table frame spanning from the DETAILS bar top to the disclaimer, 320px wide", () => {
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    expect(rects(svg)).toContainEqual([0, 80, 320, 800])
  })

  it("sizes the 4-view grid cells to fill the 880x770 area below the DETAILS bar in a 2x2 grid", () => {
    // NOTE: the original hand-coded version started the view grid at y=hH (80),
    // flush with the DETAILS bar's own top instead of below it - since the
    // DETAILS bar is full-width and the view cells' opaque white background is
    // painted *after* it, that silently covered the right two thirds of the
    // "DETAILS" label. The layout engine composes the body as a single region
    // below the DETAILS bar (both the spec table AND the view grid start at
    // y=102), which fixes that overlap as a natural consequence of not letting
    // siblings occupy the same space - not a deliberately reproduced quirk.
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    const rs = rects(svg)
    // vW = (1200-320)/2 = 440, vH = 778/2 = 389
    expect(rs).toContainEqual([320, 102, 440, 389])
    expect(rs).toContainEqual([760, 102, 440, 389])
    expect(rs).toContainEqual([320, 491, 440, 389])
    expect(rs).toContainEqual([760, 491, 440, 389])
  })

  it("flexes part-row heights to fill exactly 758px regardless of how many parts are active", () => {
    const two = buildPage1("ES", hdr, capGarment.defaultParts.filter((p) => p.on).slice(0, 2), null, null, capGarment)
    const five = buildPage1("ES", hdr, capGarment.defaultParts.filter((p) => p.on).slice(0, 5), null, null, capGarment)

    // rows start right after the 20px table header, at y=122 (80+22+20), and
    // are 320px wide (lW) - narrower than the disclaimer bar, which also has
    // y > 122 but spans the full page width, so filter on width too.
    const twoRowHeights = rects(two)
      .filter(([x, y, w]) => x === 0 && w === 320 && y >= 122)
      .map(([, , , h]) => h)
    const fiveRowHeights = rects(five)
      .filter(([x, y, w]) => x === 0 && w === 320 && y >= 122)
      .map(([, , , h]) => h)

    expect(twoRowHeights).toHaveLength(2)
    expect(twoRowHeights.reduce((a, b) => a + b, 0)).toBe(758)
    expect(twoRowHeights[0]).toBe(379)

    // 758/5 = 151.6 - with whole-pixel edge snapping rows alternate 151/152,
    // preserving the exact total with zero gaps between rows.
    expect(fiveRowHeights).toHaveLength(5)
    expect(fiveRowHeights.reduce((a, b) => a + b, 0)).toBe(758)
    fiveRowHeights.forEach((h) => expect([151, 152]).toContain(h))
  })
})

describe("buildPage1 with a garment that has no hand-drawn guides/callouts", () => {
  // Shape produced by buildCustomGarment.js for an AI-drafted "prenda desde 0".
  const bareGarment = {
    id: "custom-test",
    label: { ES: "Prenda de Prueba" },
    defaultParts: [{ id: 1, val: "Valor de prueba", on: true }],
    partLabels: { ES: { 1: "Pieza de Prueba" } },
    positions: { ES: ["Toda la prenda"] },
  }
  const hdr = { brand: "Test Brand", season: "2027", sno: "T001", cat: "Otro", fab: "Test", fac: "", ind: "", outd: "", pname: "Test" }

  it("does not throw and falls back to the generic silhouette rectangle instead of inventing a garment shape", () => {
    expect(() => buildPage1("ES", hdr, bareGarment.defaultParts, null, null, bareGarment)).not.toThrow()
    const svg = buildPage1("ES", hdr, bareGarment.defaultParts, null, null, bareGarment)
    expect(svg).toContain(GENERIC_SILHOUETTE)
  })

  it("draws no callout circles (no invented pointer coordinates)", () => {
    const svg = buildPage1("ES", hdr, bareGarment.defaultParts, null, null, bareGarment)
    expect(svg).not.toContain("<circle")
  })
})

describe("shared metrics adoption (P1 alignment)", () => {
  function textXs(svg) {
    return [...svg.matchAll(/<text x='([\d.-]+)'[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), t: m[2] }))
  }

  it("parts-list header captions sit exactly on the row columns (same stops, same alignment)", () => {
    const svg = renderPartsList(
      { x: 0, y: 0, width: 400, height: 200 },
      {
        parts: [{ id: "body", val: "Cotton", on: true }],
        partLabels: { body: "Body Panel" },
        labels: { spec: "SPECS", detail: "DETAILS" },
      }
    )
    const texts = textXs(svg)
    const header = (t) => texts.find((e) => e.t === t)
    // header caption x === data text x, per column
    expect(header("SPECS").x).toBe(texts.find((e) => e.t === "Body Panel").x)
    expect(header("DETAILS").x).toBe(texts.find((e) => e.t === "Cotton").x)
    // the phantom "Archivo / Drive" header column (no data column ever existed) is gone
    expect(svg).not.toContain("Archivo / Drive")
  })

  it("svgHeader lays both rows on one grid: every bottom-row edge lands on a top-row edge, both rows fill the page", () => {
    const hdr2 = { brand: "B", season: "S", sno: "1", cat: "C", fab: "F", fac: "X", ind: "I", outd: "O", pname: "P" }
    const svg = buildPage1("ES", hdr2, capGarment.defaultParts.slice(0, 2), null, null, capGarment)
    // label cells are the bold LBL rects; collect header-band rects (y=0 or y=40, h=40)
    const rects = [...svg.matchAll(/<rect x='([\d.]+)' y='([\d.]+)' width='([\d.]+)' height='([\d.]+)'/g)]
      .map((m) => m.slice(1).map(Number))
      .filter(([, y, , h]) => (y === 0 || y === 40) && h === 40)
    const topEdges = new Set(rects.filter(([, y]) => y === 0).flatMap(([x, , w]) => [x, x + w]))
    const bottomEdges = rects.filter(([, y]) => y === 40).flatMap(([x, , w]) => [x, x + w])
    expect(bottomEdges.length).toBeGreaterThan(0)
    bottomEdges.forEach((e) => expect(topEdges.has(e)).toBe(true))
    // both rows end flush at the page's right edge
    expect(Math.max(...topEdges)).toBe(1200)
    expect(Math.max(...bottomEdges)).toBe(1200)
  })
})

describe("reusable page block helpers", () => {
  it("renders the parts list with numbered chips, translated labels, and data values", () => {
    const svg = renderPartsList(
      { x: 0, y: 0, width: 320, height: 100 },
      {
        parts: [{ id: "body", val: "Cotton twill", on: true }],
        partLabels: { body: "Body Panel" },
        txParts: ["Sarga de algodon"],
        labels: { spec: "SPECS", detail: "DETAILS", file: "Archivo / Drive" },
      }
    )

    expect(svg).toContain("SPECS")
    expect(svg).toContain("Body Panel")
    expect(svg).toContain("Sarga de algodon")
    expect(svg).toContain("fill='#E11D3A'")
  })

  it("renders color specs with CMYK conversion and escapes color labels", () => {
    const svg = renderColorSpecs({ x: 0, y: 0, width: 370, height: 120 }, { colors: [{ name: "Blue & White", hex: "#003DA5" }] })

    expect(svg).toContain("PANTONE / CMYK")
    expect(svg).toContain("Blue &amp; White")
    expect(svg).toContain("| #003DA5")
  })

  it("renders embroidery specs and stop sequences from partial data", () => {
    const svg = renderEmbSpecs(
      { x: 0, y: 0, width: 430, height: 340 },
      {
        title: "Ficha Tecnica de Bordado",
        emb: {
          machine: "Tajima",
          stitches: "12000",
          stops: 2,
          trims: 5,
          stopSeq: [{ stop: 1, name: "Rojo", stitches: 5000 }],
        },
      }
    )

    expect(svg).toContain("Ficha Tecnica de Bordado")
    expect(svg).toContain("Tajima")
    expect(svg).toContain("12000")
    expect(svg).toContain("Stop 1: Rojo (5000 pt.)")
  })

  it("renders illustration placeholders without drawing garment vectors", () => {
    const svg = renderIllustrationZone(
      { x: 10, y: 20, width: 300, height: 180 },
      { slots: 3, refs: ["Front", "Back"], note: "Show front and back construction notes." }
    )

    expect(svg).toContain("FRONT")
    expect(svg).toContain("BACK")
    expect(svg).toContain("VISTA 3")
    expect(svg).toContain("BRIEF PARA EL ILUSTRADOR")
    expect(svg).toContain("Show") // brief text lives inside the art board
    expect(svg).not.toContain("<path")
  })
})
