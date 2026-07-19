import { describe, it, expect } from "vitest"
import { measureRegion } from "./measure.js"
import { ROW } from "../design/metrics.js"

// Contract for the measure registry used by Layout Engine v3:
//
//   measureRegion(region, page, ctx, width) → { natural, min, canAbsorb }
//
// - natural: the ideal, uncompressed content height in px for a BOUNDED
//   region, as a pure function of its data volume (and, for wrapped text,
//   the given width). null for regions that fill whatever they're given.
// - min: the smallest still-legible height (regions compress toward it).
// - canAbsorb: true for regions that soak up leftover page space
//   (illustration, spacer). Bounded data regions are false.
//
// The constants MUST agree with what each renderer in buildPages.js
// actually draws (header strip heights, metrics ROW scale) - the measure
// pass and the pixels on the page may never disagree.

const ctx = {
  lang: "ES",
  parts: [
    { id: "a", val: "v1", on: true },
    { id: "b", val: "v2", on: true },
    { id: "c", val: "v3", on: false }, // off - must not count
  ],
  designs: [
    {
      name: "Logo",
      colors: [{ name: "Blue", hex: "#003DA5" }, { name: "Red", hex: "#E11D3A" }],
      emb: { machine: "Tajima", stitches: "9000", stops: 1, trims: 2, stopSeq: [{ stop: 1, name: "Base", stitches: 9000 }] },
    },
  ],
}
const page = { id: "p", title: "P", purpose: "design:Logo" }

describe("measureRegion", () => {
  it("partsList: header strip + one table row per ACTIVE part", () => {
    const m = measureRegion({ type: "partsList" }, page, ctx, 400)
    expect(m.canAbsorb).toBe(false)
    expect(m.natural).toBe(ROW.tableHeader + 2 * ROW.table)
    expect(m.min).toBeGreaterThan(0)
    expect(m.min).toBeLessThanOrEqual(m.natural)
  })

  it("colorSpecs: section head + one color row per color at the ideal row height", () => {
    const m = measureRegion({ type: "colorSpecs" }, page, ctx, 400)
    expect(m.canAbsorb).toBe(false)
    // section head = rule gap 6 + bar 20 + gap 6 = 32 (matches renderColorSpecs)
    expect(m.natural).toBe(32 + 2 * ROW.color)
  })

  it("embSpecs: section head + 14 fixed fields + sequence header + sequence rows", () => {
    const m = measureRegion({ type: "embSpecs" }, page, ctx, 400)
    expect(m.canAbsorb).toBe(false)
    // head = 38; the sequence adds its separator row, heading row and stop
    // row, plus the renderer's 4px ideal breathing offset.
    expect(m.natural).toBe(38 + (14 + 2 + 1) * ROW.emb + 4)
  })

  it("embSpecs with no emb data measures to zero (nothing will render)", () => {
    const m = measureRegion({ type: "embSpecs" }, page, { ...ctx, designs: [{ name: "Logo" }] }, 400)
    expect(m.natural).toBe(0)
  })

  it("embSpecs treats an EMPTY_EMB-shaped object as no data", () => {
    const result = measureRegion({ type: "embSpecs" }, { purpose: "design:Logo" }, { designs: [{ name: "Logo", emb: { machine: "", stopSeq: [] } }] }, 400)
    expect(result).toEqual({ natural: 0, min: 0, canAbsorb: false })
  })

  it("note: wraps its text at the given width and measures the wrapped lines", () => {
    const narrow = measureRegion({ type: "note", note: "una nota larga que definitivamente necesita varias lineas para caber" }, page, ctx, 200)
    const wide = measureRegion({ type: "note", note: "una nota larga que definitivamente necesita varias lineas para caber" }, page, ctx, 900)
    expect(narrow.canAbsorb).toBe(false)
    expect(narrow.natural).toBeGreaterThan(wide.natural)
    expect(wide.natural).toBeGreaterThan(0)
  })

  it("illustration and spacer absorb (natural null / zero, canAbsorb true)", () => {
    const ill = measureRegion({ type: "illustration", slots: 2 }, page, ctx, 800)
    expect(ill.canAbsorb).toBe(true)
    expect(ill.natural).toBe(null)
    const sp = measureRegion({ type: "spacer" }, page, ctx, 800)
    expect(sp.canAbsorb).toBe(true)
  })

  it("chrome (header/titleBar/disclaimer) reports its fixed strip height as natural", () => {
    expect(measureRegion({ type: "header" }, page, ctx, 1148).natural).toBe(82)
    expect(measureRegion({ type: "titleBar" }, page, ctx, 1148).natural).toBe(30)
    expect(measureRegion({ type: "disclaimer" }, page, ctx, 1148).natural).toBe(20)
  })

  it("unknown region types measure as absorbing zero (never crash the pass)", () => {
    const m = measureRegion({ type: "bogus" }, page, ctx, 400)
    expect(m.natural).toBe(0)
    expect(m.canAbsorb).toBe(false)
  })
})
