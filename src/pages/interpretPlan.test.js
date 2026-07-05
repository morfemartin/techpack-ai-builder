import { describe, it, expect } from "vitest"
import { VOCAB, buildPlannedPages, interpretPagePlan, normalizePlan, weightsToGrow } from "./interpretPlan.js"

describe("weightsToGrow", () => {
  it("returns exact proportions when weights already sum to 100", () => {
    expect(weightsToGrow([{ weight: 10 }, { weight: 60 }, { weight: 30 }])).toEqual([10, 60, 30])
  })

  it("normalizes equal weights to 50/50", () => {
    expect(weightsToGrow([{ weight: 1 }, { weight: 1 }])).toEqual([50, 50])
  })

  it("treats a missing weight as 1", () => {
    expect(weightsToGrow([{}, { weight: 3 }])).toEqual([25, 75])
  })

  it("treats invalid/negative/non-finite weights as 1", () => {
    const result = weightsToGrow([{ weight: -5 }, { weight: NaN }, { weight: Infinity }, { weight: 3 }])
    expect(result[0]).toBeCloseTo(100 / 6, 5)
    expect(result[1]).toBeCloseTo(100 / 6, 5)
    expect(result[2]).toBeCloseTo(100 / 6, 5)
    expect(result[3]).toBeCloseTo(50, 5)
  })

  it("returns an empty array for empty or non-array input", () => {
    expect(weightsToGrow([])).toEqual([])
    expect(weightsToGrow(null)).toEqual([])
  })
})

describe("normalizePlan", () => {
  it("returns the fallback plan when raw is null or non-object", () => {
    const p = normalizePlan(null)
    expect(p.pages).toHaveLength(1)
    expect(p.pages[0].id).toBe("page-1")
    expect(p.pages[0].regions).toHaveLength(3)
  })

  it("returns the fallback plan when raw.pages is not an array", () => {
    expect(normalizePlan({ pages: "nope" }).pages).toHaveLength(1)
  })

  it("returns the fallback plan when raw.pages is empty", () => {
    expect(normalizePlan({ pages: [] }).pages).toHaveLength(1)
  })

  it("filters out regions whose type is not in VOCAB", () => {
    const raw = { pages: [{ regions: [{ type: "header", weight: 10 }, { type: "bogus", weight: 20 }, { type: "disclaimer", weight: 5 }] }] }
    const regions = normalizePlan(raw).pages[0].regions
    expect(regions).toHaveLength(2)
    expect(regions.map((r) => r.type)).toEqual(["header", "disclaimer"])
  })

  it("gives a page fallback regions when filtering leaves it empty (page is NOT dropped)", () => {
    const raw = { pages: [{ regions: [{ type: "bogus", weight: 10 }] }, { regions: [] }] }
    const p = normalizePlan(raw)
    expect(p.pages).toHaveLength(2) // both pages survive, each with fallback regions
    expect(p.pages[0].regions.map((r) => r.type)).toEqual(["header", "disclaimer"])
    expect(p.pages[1].regions.map((r) => r.type)).toEqual(["header", "disclaimer"])
  })

  it("replaces an invalid weight with 1", () => {
    const raw = { pages: [{ regions: [{ type: "header", weight: -10 }, { type: "disclaimer", weight: NaN }] }] }
    const regions = normalizePlan(raw).pages[0].regions
    expect(regions[0].weight).toBe(1)
    expect(regions[1].weight).toBe(1)
  })

  it("preserves extra region props while normalizing weight", () => {
    const raw = { pages: [{ regions: [{ type: "illustration", weight: 60, slots: 3, note: "sweater front" }] }] }
    expect(normalizePlan(raw).pages[0].regions[0]).toEqual({ type: "illustration", weight: 60, slots: 3, note: "sweater front" })
  })

  it("guarantees id/title/purpose with fallbacks", () => {
    const p = normalizePlan({ pages: [{}, {}] })
    expect(p.pages[0].id).toBe("page-1")
    expect(p.pages[0].title).toBe("")
    expect(p.pages[0].purpose).toBe("overview")
    expect(p.pages[1].id).toBe("page-2")
  })

  it("does not mutate the input", () => {
    const raw = { pages: [{ id: "custom", regions: [{ type: "header", weight: 5 }] }] }
    const copy = JSON.parse(JSON.stringify(raw))
    normalizePlan(raw)
    expect(raw).toEqual(copy)
  })

  it("keeps VOCAB as the closed region-type list", () => {
    expect(VOCAB).toContain("illustration")
    expect(VOCAB).not.toContain("bogus")
  })
})

describe("interpretPagePlan", () => {
  const ctx = {
    lang: "ES",
    hdr: { brand: "Morfe", season: "2027", sno: "S-1", cat: "Custom", fab: "Cotton", fac: "", ind: "", outd: "", pname: "Hoodie" },
    parts: [{ id: "body", val: "French terry", on: true }],
    designs: [
      { name: "Chest Logo", colors: [{ name: "Blue", hex: "#003DA5" }], emb: { machine: "Tajima", stitches: "12000", stops: 1, trims: 2, stopSeq: [] }, illustrationBrief: "Place logo on left chest." },
    ],
    logo: null,
    txData: null,
    garment: { partLabels: { ES: { body: "Cuerpo" } } },
  }

  it("returns a column tree with normalized grows for each planned region", () => {
    const root = interpretPagePlan(
      {
        id: "overview",
        title: "Overview",
        purpose: "overview",
        regions: [
          { type: "header", weight: 10 },
          { type: "partsList", weight: 30 },
          { type: "disclaimer", weight: 10 },
        ],
      },
      ctx
    )

    expect(root.direction).toBe("column")
    expect(root.children).toHaveLength(3)
    expect(root.children[0].grow).toBe(20)
    expect(root.children[1].grow).toBe(60)
    expect(root.children[2].grow).toBe(20)
  })

  it("renders planned pages into the same [{name,svg}] shape as buildAllPages", () => {
    const pages = buildPlannedPages(
      {
        pages: [
          {
            id: "custom-overview",
            title: "Custom Overview",
            purpose: "overview",
            regions: [
              { type: "header", weight: 10 },
              { type: "titleBar", weight: 5 },
              { type: "illustration", weight: 45, slots: 2, refs: ["Front", "Back"], note: "Show construction." },
              { type: "partsList", weight: 30 },
              { type: "disclaimer", weight: 10 },
            ],
          },
        ],
      },
      ctx
    )

    expect(pages).toHaveLength(1)
    expect(pages[0].name).toBe("custom_overview")
    expect(pages[0].svg).toContain("<svg")
    expect(pages[0].svg).toContain("Custom Overview")
    expect(pages[0].svg).toContain("Front")
    expect(pages[0].svg).toContain("Cuerpo")
    expect(pages[0].svg).toContain("Todos los disenos")
  })

  it("uses the matching design when a page purpose points to design:name", () => {
    const pages = buildPlannedPages(
      {
        pages: [
          {
            id: "logo",
            title: "Logo",
            purpose: "design:Chest Logo",
            regions: [
              { type: "colorSpecs", weight: 1 },
              { type: "embSpecs", weight: 1 },
            ],
          },
        ],
      },
      ctx
    )

    expect(pages[0].svg).toContain("Blue")
    expect(pages[0].svg).toContain("Tajima")
    expect(pages[0].svg).toContain("12000")
  })
})

describe("split composition (2D layout)", () => {
  const ctx = {
    lang: "ES",
    hdr: { brand: "Morfe", pname: "Hoodie" },
    parts: [{ id: "body", val: "French terry", on: true }],
    designs: [{ name: "Chest Logo", colors: [{ name: "Blue", hex: "#003DA5" }], illustrationBrief: "Left chest." }],
    logo: null,
    txData: null,
    garment: { partLabels: { ES: { body: "Cuerpo" } } },
  }

  it("keeps a split region and normalizes its inner leaf regions, dropping unknown ones", () => {
    const raw = { pages: [{ regions: [{ type: "split", weight: 60, regions: [{ type: "partsList", weight: 30 }, { type: "bogus", weight: 10 }, { type: "illustration", weight: 70, slots: 2 }] }] }] }
    const regions = normalizePlan(raw).pages[0].regions
    expect(regions).toHaveLength(1)
    expect(regions[0].type).toBe("split")
    expect(regions[0].regions.map((r) => r.type)).toEqual(["partsList", "illustration"])
  })

  it("drops a split whose inner regions are all invalid (renders as a blank row otherwise)", () => {
    const raw = { pages: [{ regions: [{ type: "split", weight: 50, regions: [{ type: "bogus" }] }, { type: "header", weight: 10 }] }] }
    expect(normalizePlan(raw).pages[0].regions.map((r) => r.type)).toEqual(["header"])
  })

  it("builds a horizontal row for a split, inner grows taken from inner weights", () => {
    const root = interpretPagePlan(
      { id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "split", weight: 80, regions: [{ type: "partsList", weight: 25 }, { type: "illustration", weight: 75, slots: 1 }] }, { type: "disclaimer", weight: 10 }] },
      ctx
    )
    expect(root.children).toHaveLength(3)
    const splitNode = root.children[1]
    expect(splitNode.direction).toBe("row")
    expect(splitNode.children).toHaveLength(2)
    expect(splitNode.children[0].grow).toBe(25)
    expect(splitNode.children[1].grow).toBe(75)
  })

  it("renders both columns of a split into the same page svg", () => {
    const pages = buildPlannedPages(
      { pages: [{ id: "split-page", title: "Split", purpose: "overview", regions: [{ type: "split", weight: 100, regions: [{ type: "partsList", weight: 40 }, { type: "illustration", weight: 60, slots: 1, refs: ["Frente"] }] }] }] },
      ctx
    )
    expect(pages[0].svg).toContain("Cuerpo") // partsList column
    expect(pages[0].svg).toContain("Frente") // illustration column
  })
})
