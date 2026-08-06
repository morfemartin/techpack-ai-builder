import { describe, it, expect } from "vitest"
import {
  newColorway, normalizeColorway, colorwaysFromFabricColors, suffixFor, colorwayStyleCode,
  applyColorway, colorwayWarnings, renderColorwayDocument,
} from "./colorways.js"

describe("suffixFor", () => {
  it("uses initials for multi-word names", () => {
    expect(suffixFor("Silver Lake Blue")).toBe("SLB")
    expect(suffixFor("Fair Green")).toBe("FG")
  })

  it("takes the first 3 letters for a single word", () => {
    expect(suffixFor("Navy")).toBe("NAV")
  })

  it("returns empty for an unnamed colorway", () => {
    expect(suffixFor("")).toBe("")
    expect(suffixFor(undefined)).toBe("")
  })
})

describe("colorwayStyleCode", () => {
  it("matches the real per-colorway convention from production docs", () => {
    expect(colorwayStyleCode("AA-POLO-001", newColorway({ name: "Fair Green" }))).toBe("AA-POLO-001-FG")
    expect(colorwayStyleCode("AA-POLO-001", newColorway({ name: "Silver Lake Blue" }))).toBe("AA-POLO-001-SLB")
  })

  it("falls back to the base code alone when the colorway has no name", () => {
    expect(colorwayStyleCode("AA-POLO-001", newColorway({}))).toBe("AA-POLO-001")
  })
})

describe("newColorway / normalizeColorway / colorwaysFromFabricColors", () => {
  it("normalizes fabricColors and defaults threadOverrides to an empty object", () => {
    const cw = newColorway({ name: "Fair Green", fabricColors: [{ name: "Fair Green", hex: "#92af88" }] })
    expect(cw.name).toBe("Fair Green")
    expect(cw.fabricColors[0].hex).toBe("#92AF88")
    expect(cw.threadOverrides).toEqual({})
  })

  it("migrates a flat fabricColors array into a single base colorway", () => {
    const flat = [{ name: "Fair Green", hex: "#92af88" }]
    const colorways = colorwaysFromFabricColors(flat)
    expect(colorways).toHaveLength(1)
    expect(colorways[0].fabricColors).toHaveLength(1)
    expect(colorways[0].name).toBe("")
  })

  it("normalizeColorway tolerates a missing/malformed raw value", () => {
    expect(normalizeColorway(null).fabricColors).toEqual([])
    expect(normalizeColorway(undefined).threadOverrides).toEqual({})
  })
})

describe("applyColorway", () => {
  const baseCtx = {
    hdr: { sno: "AA-POLO-001", pname: "Polo" },
    fabricColors: [{ name: "Fair Green", hex: "#92af88" }],
    designs: [
      { id: 1, name: "Chest Logo", tec: "Bordado 3D", colors: [{ name: "Old Gold", hex: "#c8a415" }], emb: { stopSeq: [{ stop: 1, code: "1055", name: "Latte" }] } },
      { id: 2, name: "Print", tec: "Sublimacion", colors: [{ name: "Old Gold", hex: "#c8a415" }] },
    ],
  }

  it("does not mutate the base ctx", () => {
    const snapshot = JSON.parse(JSON.stringify(baseCtx))
    applyColorway(baseCtx, newColorway({ name: "Silver Lake Blue", fabricColors: [{ name: "Silver Lake Blue", hex: "#5f8bb8" }] }))
    expect(baseCtx).toEqual(snapshot)
  })

  it("swaps fabricColors and the style code for the colorway", () => {
    const cw = newColorway({ name: "Silver Lake Blue", fabricColors: [{ name: "Silver Lake Blue", hex: "#5f8bb8" }] })
    const applied = applyColorway(baseCtx, cw)
    expect(applied.fabricColors[0].name).toBe("Silver Lake Blue")
    expect(applied.hdr.sno).toBe("AA-POLO-001-SLB")
  })

  it("leaves a design's colors untouched when the colorway has no override for it", () => {
    const cw = newColorway({ name: "Silver Lake Blue" })
    const applied = applyColorway(baseCtx, cw)
    expect(applied.designs[0].colors).toEqual(baseCtx.designs[0].colors)
  })

  // The safety-critical property: a colorway's thread override must re-derive
  // stopSeq through the SAME path App.jsx's updDesignColors uses, or the
  // printed thread sequence disagrees with the printed swatches.
  it("re-derives stopSeq from an overridden thread color via madeiraColorsToStops", () => {
    const cw = newColorway({
      name: "Silver Lake Blue",
      threadOverrides: { 1: [{ name: "Madeira 1352 Old Gold", hex: "#c8a415", madeira: { code: "1352", name: "Old Gold" } }] },
    })
    const applied = applyColorway(baseCtx, cw)
    expect(applied.designs[0].colors[0].madeira.code).toBe("1352")
    expect(applied.designs[0].emb.stopSeq[0]).toMatchObject({ code: "1352", name: "Old Gold" })
    // Untouched design (id 2, no override) still carries its base colors.
    expect(applied.designs[1].colors).toEqual(baseCtx.designs[1].colors)
  })
})

describe("colorwayWarnings", () => {
  const designs = [
    { id: 1, name: "Chest Logo", tec: "Bordado 3D" },
    { id: 2, name: "Back Print", tec: "Sublimacion" },
  ]

  it("warns for an embroidery design with no thread override in a non-base colorway", () => {
    const colorways = [newColorway({ name: "Fair Green" }), newColorway({ name: "Silver Lake Blue" })]
    const warnings = colorwayWarnings(colorways, designs)
    expect(warnings).toEqual([{ colorwayId: colorways[1].id, colorwayName: "Silver Lake Blue", designId: 1, designName: "Chest Logo" }])
  })

  it("never warns about the base colorway (index 0) or a non-embroidery design", () => {
    const colorways = [newColorway({ name: "Fair Green" })]
    expect(colorwayWarnings(colorways, designs)).toEqual([])
  })

  it("stays silent once a colorway has an explicit override", () => {
    const covered = newColorway({ name: "Silver Lake Blue", threadOverrides: { 1: [{ name: "Blanco" }] } })
    const colorways = [newColorway({ name: "Fair Green" }), covered]
    expect(colorwayWarnings(colorways, designs)).toEqual([])
  })
})

describe("renderColorwayDocument retitles and flags the colorways page", () => {
  const plan = {
    pages: [
      { id: "colores", title: "Colores de tela", purpose: "data:colorways", regions: [{ type: "header", weight: 10 }, { type: "titleBar", weight: 8 }, { type: "colorSpecs", weight: 30 }, { type: "disclaimer", weight: 10 }] },
    ],
  }
  const ctx = {
    lang: "ES",
    hdr: { brand: "Arrive Aruba", season: "2027", sno: "AA-POLO-001", cat: "Custom", fab: "", fac: "", ind: "", outd: "", pname: "Polo" },
    parts: [],
    designs: [{ id: 1, name: "Chest Logo", tec: "Bordado 3D", colors: [{ name: "Old Gold" }] }],
    logo: null,
    txData: null,
    garment: { partLabels: { ES: {} } },
    fabricColors: [{ name: "Fair Green", hex: "#92af88" }],
  }

  it("suffixes the data:colorways page title with the colorway name, only when multi-colorway", () => {
    const colorways = [newColorway({ name: "Fair Green", fabricColors: ctx.fabricColors }), newColorway({ name: "Silver Lake Blue", fabricColors: [{ name: "Silver Lake Blue" }] })]
    const pages = renderColorwayDocument(plan, ctx, colorways)
    expect(pages[0].title).toBe("Colores de tela — Fair Green")
    expect(pages[1].title).toBe("Colores de tela — Silver Lake Blue")
  })

  it("leaves the title untouched with a single colorway (no regression)", () => {
    const pages = renderColorwayDocument(plan, ctx, [newColorway({ name: "Fair Green", fabricColors: ctx.fabricColors })])
    expect(pages[0].title).toBe("Colores de tela")
  })

  it("prints the inherited-thread note on a non-base colorway that never overrode it", () => {
    const colorways = [newColorway({ name: "Fair Green" }), newColorway({ name: "Silver Lake Blue" })]
    const pages = renderColorwayDocument(plan, ctx, colorways)
    expect(pages[1].svg).toContain("heredado")
    expect(pages[1].svg).toContain("Chest Logo")
    expect(pages[0].svg).not.toContain("heredado") // base colorway is never "inherited from itself"
  })
})

describe("renderColorwayDocument", () => {
  const plan = { pages: [{ id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "partsList", weight: 30 }, { type: "disclaimer", weight: 10 }] }] }
  const ctx = {
    lang: "ES",
    hdr: { brand: "Arrive Aruba", season: "2027", sno: "AA-POLO-001", cat: "Custom", fab: "", fac: "", ind: "", outd: "", pname: "Polo" },
    parts: [{ id: 1, val: "91% Poliester", on: true }],
    designs: [],
    logo: null,
    txData: null,
    garment: { partLabels: { ES: {} } },
    fabricColors: [{ name: "Fair Green", hex: "#92af88" }],
  }

  it("re-renders the same plan once per colorway with zero extra planning", () => {
    const colorways = [newColorway({ name: "Fair Green" }), newColorway({ name: "Silver Lake Blue" })]
    const pages = renderColorwayDocument(plan, ctx, colorways)
    expect(pages).toHaveLength(2) // 1 page x 2 colorways
    expect(pages[0].colorway).toBe(colorways[0].id)
    expect(pages[1].colorway).toBe(colorways[1].id)
  })

  it("prefixes page names by colorway suffix only when there is more than one", () => {
    const colorways = [newColorway({ name: "Fair Green" }), newColorway({ name: "Silver Lake Blue" })]
    const pages = renderColorwayDocument(plan, ctx, colorways)
    expect(pages[0].name.startsWith("FG-")).toBe(true)
    expect(pages[1].name.startsWith("SLB-")).toBe(true)
  })

  it("with a single colorway, output is identical to plain buildPlannedPages (no regression)", () => {
    const colorways = [newColorway({ name: "", fabricColors: ctx.fabricColors })]
    const pages = renderColorwayDocument(plan, ctx, colorways)
    expect(pages[0].name).not.toMatch(/^[A-Z]+-/)
    expect(pages[0].svg).toContain("Arrive Aruba")
  })

  it("falls back to a single colorway derived from ctx.fabricColors when none is given", () => {
    const pages = renderColorwayDocument(plan, ctx, [])
    expect(pages).toHaveLength(1)
  })
})
