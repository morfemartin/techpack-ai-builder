import { describe, it, expect } from "vitest"
import { CONTRACTS, layoutPolicyFor, normalizePriority, purposeFamily, validatePage, repairPage, validateOutline, repairOutline } from "./pageContracts.js"

// Contract for the page-contract system used by Layout Engine v3:
// deterministic encoding of how a tech-pack designer thinks - what MUST be
// visually present per page purpose, what never repeats, what deserves a
// page - applied as validate + repair over whatever the AI proposed. The AI
// plan is a suggestion; the contract is the guarantee.

const ctx = {
  garmentType: "Hoodie",
  lang: "ES",
  parts: [
    { id: "body", val: "French terry", on: true },
    { id: "hood", val: "Doble capa", on: true },
  ],
  designs: [
    { name: "Chest Logo", pos: "Pecho izquierdo", tec: "Bordado 3D", colors: [{ name: "Blue", hex: "#003DA5" }], emb: { machine: "Tajima", stitches: "9000", stopSeq: [] } },
    { name: "Woven Label", pos: "Cuello interior", tec: "Jacquard", colors: [] },
  ],
}

const chrome = [
  { type: "header", weight: 10 },
  { type: "titleBar", weight: 5 },
]
const disclaimer = { type: "disclaimer", weight: 8 }

describe("purposeFamily", () => {
  it("maps design:<name> to the design family and unknown purposes to structure", () => {
    expect(purposeFamily("design:Chest Logo")).toBe("design")
    expect(purposeFamily("overview")).toBe("overview")
    expect(purposeFamily("cover")).toBe("cover")
    expect(purposeFamily("index")).toBe("index")
    expect(purposeFamily("whatever")).toBe("structure")
  })
})

describe("layout policy", () => {
  it("exposes purpose-specific priorities and bounded illustration shares", () => {
    const overview = layoutPolicyFor({ purpose: "overview" })
    expect(overview.priorityRank.illustration).toBeGreaterThan(overview.priorityRank.partsList)
    expect(layoutPolicyFor({ purpose: "design:Chest Logo" }).illustrationShare).toEqual({ min: 0.55, max: 0.78 })
  })

  it("normalizes arbitrary model priorities into the supported 1-3 range", () => {
    expect(normalizePriority(-20)).toBe(1)
    expect(normalizePriority(2.4)).toBe(2)
    expect(normalizePriority(99)).toBe(3)
    expect(normalizePriority("bad", 2)).toBe(2)
  })
})

describe("validatePage", () => {
  it("flags missing mandatory regions for the purpose", () => {
    const page = { id: "p", purpose: "overview", regions: [...chrome, disclaimer] } // no illustration, no partsList
    const codes = validatePage(page, ctx).map((v) => v.code)
    expect(codes).toContain("missing-mandatory")
    const missing = validatePage(page, ctx).filter((v) => v.code === "missing-mandatory").map((v) => v.type)
    expect(missing).toContain("illustration")
    expect(missing).toContain("partsList")
  })

  it("flags forbidden regions (BOM never repeats on a design page)", () => {
    const page = { id: "p", purpose: "design:Chest Logo", regions: [...chrome, { type: "partsList", weight: 30 }, { type: "illustration", weight: 60, slots: 1 }, { type: "colorSpecs", weight: 20 }, { type: "embSpecs", weight: 20 }, disclaimer] }
    const v = validatePage(page, ctx)
    expect(v.some((x) => x.code === "forbidden-region" && x.type === "partsList")).toBe(true)
  })

  it("conditional mandatory: a design page needs colorSpecs/embSpecs only when the design HAS that data", () => {
    // Chest Logo has colors + emb -> both mandatory
    const bare = { id: "p", purpose: "design:Chest Logo", regions: [...chrome, { type: "illustration", weight: 60, slots: 1 }, disclaimer] }
    const missing = validatePage(bare, ctx).filter((v) => v.code === "missing-mandatory").map((v) => v.type)
    expect(missing).toContain("colorSpecs")
    expect(missing).toContain("embSpecs")
    // Woven Label has neither colors nor emb -> neither mandatory
    const label = { id: "p2", purpose: "design:Woven Label", regions: [...chrome, { type: "illustration", weight: 60, slots: 1 }, disclaimer] }
    const missing2 = validatePage(label, ctx).filter((v) => v.code === "missing-mandatory").map((v) => v.type)
    expect(missing2).not.toContain("colorSpecs")
    expect(missing2).not.toContain("embSpecs")
  })

  it("counts regions inside a split toward presence", () => {
    const page = {
      id: "p",
      purpose: "overview",
      regions: [...chrome, { type: "split", weight: 70, regions: [{ type: "partsList", weight: 30 }, { type: "illustration", weight: 70, slots: 2 }] }, disclaimer],
    }
    const codes = validatePage(page, ctx).map((v) => v.code)
    expect(codes).not.toContain("missing-mandatory")
  })

  it("flags empty-data regions (colorSpecs on a design with no colors)", () => {
    const page = { id: "p", purpose: "design:Woven Label", regions: [...chrome, { type: "illustration", weight: 60, slots: 1 }, { type: "colorSpecs", weight: 20 }, disclaimer] }
    const v = validatePage(page, ctx)
    expect(v.some((x) => x.code === "empty-data-region" && x.type === "colorSpecs")).toBe(true)
  })

  it("flags duplicated singleton regions", () => {
    const page = { id: "p", purpose: "overview", regions: [...chrome, { type: "partsList", weight: 20 }, { type: "illustration", weight: 40, slots: 1 }, { type: "partsList", weight: 20 }, disclaimer] }
    const v = validatePage(page, ctx)
    expect(v.some((x) => x.code === "duplicate-region" && x.type === "partsList")).toBe(true)
  })

  it("accepts a fully conforming page with no violations", () => {
    const page = {
      id: "p",
      purpose: "design:Chest Logo",
      regions: [...chrome, { type: "split", weight: 70, regions: [{ type: "colorSpecs", weight: 30 }, { type: "illustration", weight: 70, slots: 1 }] }, { type: "embSpecs", weight: 20 }, disclaimer],
    }
    expect(validatePage(page, ctx)).toEqual([])
  })
})

describe("repairPage", () => {
  it("assigns contract priorities recursively and clamps invalid model values", () => {
    const page = { id: "p", purpose: "overview", regions: [...chrome, { type: "split", regions: [{ type: "partsList", priority: 99 }, { type: "illustration" }] }, disclaimer] }
    const { page: fixed } = repairPage(page, ctx)
    const split = fixed.regions.find((region) => region.type === "split")
    expect(split.regions.map((region) => [region.type, region.priority])).toEqual([["partsList", 3], ["illustration", 3]])
    expect(validatePage(fixed, ctx)).toEqual([])
  })
  it("inserts missing mandatory regions with sensible defaults and reports each repair", () => {
    const page = { id: "p", purpose: "overview", regions: [...chrome, disclaimer] }
    const { page: fixed, repairs } = repairPage(page, ctx)
    const types = fixed.regions.map((r) => r.type)
    expect(types).toContain("illustration")
    expect(types).toContain("partsList")
    expect(repairs.length).toBeGreaterThan(0)
    // repaired page passes its own validation
    expect(validatePage(fixed, ctx)).toEqual([])
  })

  it("drops forbidden and empty-data regions", () => {
    const page = {
      id: "p",
      purpose: "design:Woven Label",
      regions: [...chrome, { type: "partsList", weight: 20 }, { type: "illustration", weight: 50, slots: 1 }, { type: "colorSpecs", weight: 20 }, disclaimer],
    }
    const { page: fixed } = repairPage(page, ctx)
    const types = fixed.regions.map((r) => r.type)
    expect(types).not.toContain("partsList")
    expect(types).not.toContain("colorSpecs")
    expect(validatePage(fixed, ctx)).toEqual([])
  })

  it("dedupes singleton regions keeping the first occurrence", () => {
    const page = { id: "p", purpose: "overview", regions: [...chrome, { type: "partsList", weight: 20, marker: "first" }, { type: "illustration", weight: 40, slots: 1 }, { type: "partsList", weight: 20, marker: "second" }, disclaimer] }
    const { page: fixed } = repairPage(page, ctx)
    const lists = fixed.regions.filter((r) => r.type === "partsList")
    expect(lists).toHaveLength(1)
    expect(lists[0].marker).toBe("first")
  })

  it("enforces canonical chrome order: header first, titleBar second, disclaimer last", () => {
    const page = { id: "p", purpose: "overview", regions: [disclaimer, { type: "partsList", weight: 20 }, { type: "illustration", weight: 40, slots: 1 }, ...chrome] }
    const { page: fixed } = repairPage(page, ctx)
    const types = fixed.regions.map((r) => r.type)
    expect(types[0]).toBe("header")
    expect(types[1]).toBe("titleBar")
    expect(types[types.length - 1]).toBe("disclaimer")
  })

  it("repairs an empty/garbage page into a fully conforming one", () => {
    const { page: fixed, repairs } = repairPage({ id: "p", purpose: "design:Chest Logo", regions: [] }, ctx)
    expect(validatePage(fixed, ctx)).toEqual([])
    expect(repairs.length).toBeGreaterThan(0)
    // design page defaults: illustration ref anchored on the design's position
    const ill = fixed.regions.find((r) => r.type === "illustration")
    expect(ill.refs && ill.refs.length).toBeGreaterThan(0)
  })
})

describe("outline contract", () => {
  it("validateOutline flags missing cover, missing BOM coverage, and uncovered designs", () => {
    const outline = { pages: [{ id: "d1", title: "Chest Logo", purpose: "design:Chest Logo" }] }
    const codes = validateOutline(outline, ctx).map((v) => v.code)
    expect(codes).toContain("missing-cover")
    expect(codes).toContain("missing-bom-page")
    expect(codes).toContain("design-uncovered") // Woven Label has no page
  })

  it("repairOutline inserts cover first, a BOM page, and one page per uncovered design; drops duplicate design pages", () => {
    const outline = {
      pages: [
        { id: "d1", title: "Chest Logo", purpose: "design:Chest Logo" },
        { id: "d1b", title: "Chest Logo again", purpose: "design:Chest Logo" },
      ],
    }
    const { outline: fixed, repairs } = repairOutline(outline, ctx)
    expect(fixed.pages[0].purpose).toBe("cover")
    expect(fixed.pages.some((p) => p.purpose === "overview" || p.purpose === "structure" || p.purpose.startsWith("structure:"))).toBe(true)
    const chestPages = fixed.pages.filter((p) => p.purpose === "design:Chest Logo")
    expect(chestPages).toHaveLength(1)
    expect(fixed.pages.some((p) => p.purpose === "design:Woven Label")).toBe(true)
    expect(repairs.length).toBeGreaterThan(0)
    expect(validateOutline(fixed, ctx)).toEqual([])
  })

  it("leaves a conforming outline untouched", () => {
    const outline = {
      pages: [
        { id: "cover", title: "Hoodie", purpose: "cover" },
        { id: "overview", title: "Estructura", purpose: "overview" },
        { id: "d1", title: "Chest Logo", purpose: "design:Chest Logo" },
        { id: "d2", title: "Woven Label", purpose: "design:Woven Label" },
      ],
    }
    const { outline: fixed, repairs } = repairOutline(outline, ctx)
    expect(repairs).toEqual([])
    expect(fixed.pages.map((p) => p.id)).toEqual(["cover", "overview", "d1", "d2"])
  })

  it("accepts a distributed BOM only when every active part is covered exactly once", () => {
    const distributed = {
      pages: [
        { id: "cover", title: "Hoodie", purpose: "cover" },
        { id: "body-system", title: "Body", purpose: "structure:body", pieces: ["body"] },
        { id: "hood-system", title: "Hood", purpose: "structure:hood", pieces: ["hood"] },
        { id: "d1", title: "Chest Logo", purpose: "design:Chest Logo" },
        { id: "d2", title: "Woven Label", purpose: "design:Woven Label" },
      ],
    }
    expect(validateOutline(distributed, ctx)).toEqual([])
    distributed.pages[2].pieces = ["body"]
    const errors = validateOutline(distributed, ctx)
    expect(errors).toEqual(expect.arrayContaining([
      { code: "part-duplicated", detail: "body" },
      { code: "part-uncovered", detail: "hood" },
    ]))
  })

  it("splits an overloaded distributed page instead of shrinking its artboards", () => {
    const manyParts = Array.from({ length: 17 }, (_, index) => ({ id: "p" + (index + 1), on: true }))
    const outline = {
      pages: [
        { id: "cover", purpose: "cover" },
        { id: "all-parts", title: "All parts", purpose: "structure:body", pieces: manyParts.map((part) => part.id) },
      ],
    }
    expect(validateOutline(outline, { parts: manyParts }).map((error) => error.code)).toContain("part-page-overloaded")
    const repaired = repairOutline(outline, { parts: manyParts }).outline
    const structure = repaired.pages.filter((page) => page.purpose === "structure:body")
    expect(structure.map((page) => page.pieces.length)).toEqual([6, 6, 5])
    expect(validateOutline(repaired, { parts: manyParts })).toEqual([])
  })
})

describe("CONTRACTS shape", () => {
  it("exposes a contract for every purpose family", () => {
    for (const fam of ["cover", "index", "overview", "structure", "lining", "label", "design"]) {
      expect(CONTRACTS[fam]).toBeTruthy()
      expect(Array.isArray(CONTRACTS[fam].mandatory)).toBe(true)
    }
  })
})

// A design's colour/embroidery data belongs to that design's own page. It used
// to leak onto construction pages: overview/structure/lining forbade nothing,
// and selectedDesign falls back to designs[0] for any page without its own
// design token - so a BOM page happily rendered the first design's specs as
// "just another block", on page after page.
describe("design data stays on the design's own page", () => {
  const withDesignBlocks = [...chrome, { type: "partsList", weight: 10 }, { type: "colorSpecs", weight: 6 }, { type: "embSpecs", weight: 6 }, { type: "illustration", weight: 40 }, disclaimer]

  it.each(["overview", "structure:shell-body", "lining"])("strips colorSpecs/embSpecs from a %s page", (purpose) => {
    const repaired = repairPage({ id: "p", title: "T", purpose, regions: withDesignBlocks }, ctx).page
    const types = repaired.regions.map((r) => r.type)
    expect(types).not.toContain("colorSpecs")
    expect(types).not.toContain("embSpecs")
    // the construction content it does own is untouched
    expect(types).toEqual(expect.arrayContaining(["partsList", "illustration"]))
  })

  it("keeps them on the design page they describe", () => {
    const repaired = repairPage({ id: "d", title: "Chest Logo", purpose: "design:Chest Logo", regions: [...chrome, { type: "colorSpecs", weight: 6 }, { type: "embSpecs", weight: 6 }, { type: "illustration", weight: 40 }, disclaimer] }, ctx).page
    const types = repaired.regions.map((r) => r.type)
    expect(types).toEqual(expect.arrayContaining(["colorSpecs", "embSpecs"]))
  })
})
