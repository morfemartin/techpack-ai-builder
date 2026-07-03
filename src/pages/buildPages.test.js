import { describe, it, expect } from "vitest"
import { buildPage1 } from "./buildPages.js"
import { capGarment } from "../garments/cap.js"
import { GENERIC_SILHOUETTE } from "../garments/genericSilhouette.js"

// These assert the exact geometry the old hand-computed pixel math produced
// (hH=80, detailsBar=22, tableHeader=20, discH=28 on an 1200x900 page -> a
// body row of 792px, spec-table rows sharing 792-22-20=750px), so the switch
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

  it("keeps the disclaimer bar at the bottom, full width, 28px tall", () => {
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    expect(rects(svg)).toContainEqual([0, 872, 1200, 28])
  })

  it("draws the spec-table frame spanning from the DETAILS bar top to the disclaimer, 320px wide", () => {
    const parts = capGarment.defaultParts.slice(0, 3)
    const svg = buildPage1("ES", hdr, parts, null, null, capGarment)
    expect(rects(svg)).toContainEqual([0, 80, 320, 792])
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
    // vW = (1200-320)/2 = 440, vH = 770/2 = 385
    expect(rs).toContainEqual([320, 102, 440, 385])
    expect(rs).toContainEqual([760, 102, 440, 385])
    expect(rs).toContainEqual([320, 487, 440, 385])
    expect(rs).toContainEqual([760, 487, 440, 385])
  })

  it("flexes part-row heights to fill exactly 750px regardless of how many parts are active", () => {
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
    expect(twoRowHeights.reduce((a, b) => a + b, 0)).toBeCloseTo(750, 5)
    expect(twoRowHeights[0]).toBeCloseTo(375, 5)

    expect(fiveRowHeights).toHaveLength(5)
    expect(fiveRowHeights.reduce((a, b) => a + b, 0)).toBeCloseTo(750, 5)
    expect(fiveRowHeights[0]).toBeCloseTo(150, 5)
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
