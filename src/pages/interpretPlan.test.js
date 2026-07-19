import { describe, it, expect } from "vitest"
import { VOCAB, buildPlannedPages, effectivePartsForPage, interpretPagePlan, normalizePlan, weightsToGrow } from "./interpretPlan.js"
import { solveLayout } from "../layout/solve.js"

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

  it("keeps chrome fixed, sizes data to content, and parks the slack in a spacer before the bottom chrome", () => {
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
    // header + partsList + injected slack-spacer + disclaimer: this page has
    // no absorber (no illustration), so measure-then-solve parks the leftover
    // in ONE invisible spacer pinned just above the disclaimer.
    expect(root.children).toHaveLength(4)
    // header: fixed strip, does not grow
    expect(root.children[0].grow).toBe(0)
    expect(root.children[0].basis).toBe(64)
    // partsList: bounded content at its natural height (1 part = 16 header
    // strip + 18 table row), never stretched by the plan weight anymore
    expect(root.children[1].grow).toBe(0)
    expect(root.children[1].basis).toBe(34)
    // slack spacer: the only growing node
    expect(root.children[2].grow).toBe(1)
    // disclaimer: fixed strip, pinned to the bottom
    expect(root.children[3].grow).toBe(0)
    expect(root.children[3].basis).toBe(24)
  })

  it("gives a bounded band its measured height and routes ALL slack to the absorber, whatever the AI's weights say", () => {
    const root = interpretPagePlan(
      {
        id: "p",
        title: "P",
        purpose: "overview",
        regions: [
          { type: "header", weight: 10 },
          // the model absurdly over-weights the note (30) vs the illustration (40) -
          // measure-then-solve must ignore that for the bounded note
          { type: "note", note: "Nota corta.", weight: 30 },
          { type: "illustration", weight: 40, slots: 1 },
          { type: "disclaimer", weight: 10 },
        ],
      },
      ctx
    )
    expect(root.children).toHaveLength(3)
    const composition = root.children[1]
    expect(composition.direction).toBe("column")
    expect(composition.grow).toBe(1)
    expect(composition.children.some((child) => child.basis > 0)).toBe(true)
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
    expect(pages[0].svg).toContain("FRONT")
    expect(pages[0].svg).toContain("Cuerpo")
    expect(pages[0].svg).toContain("width='297mm'")
    expect(pages[0].svg).toContain("P. 01 / 01")
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

  it("builds a horizontal row for a split when the content column has enough real content to fill it", () => {
    // A dense table cannot share the vertical axis with a useful illustration,
    // so the evaluator chooses columns and sizes them from content constraints.
    const fullCtx = { ...ctx, parts: Array.from({ length: 12 }, (_, i) => ({ id: "p" + i, val: "Valor " + i, on: true })) }
    const root = interpretPagePlan(
      { id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "split", weight: 80, regions: [{ type: "partsList", weight: 25 }, { type: "illustration", weight: 75, slots: 1 }] }, { type: "disclaimer", weight: 10 }] },
      fullCtx
    )
    expect(root.children).toHaveLength(3)
    const splitNode = root.children[1]
    expect(splitNode.direction).toBe("row")
    expect(splitNode.children).toHaveLength(2)
    expect(splitNode.children.every((child) => child.grow === 0)).toBe(true)
    expect(splitNode.children[0].basis).toBeGreaterThanOrEqual(320)
    expect(splitNode.children[1].basis).toBeGreaterThan(splitNode.children[0].basis)
  })

  // The core fix for the reported design critique: a split that pairs an
  // illustration with a SHORT specs/parts block used to always stretch that
  // block into a full-height side column next to the illustration, leaving
  // visible dead white space below a one- or two-row table. With only 1 part
  // row (needs ~50px) against a split allotted ~718px, the compositor should
  // stack instead: illustration on top (grows to fill), the short block below
  // sized to its own natural content height.
  it("stacks illustration-on-top + content-below when the content column would mostly be dead white space", () => {
    const root = interpretPagePlan(
      { id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "split", weight: 80, regions: [{ type: "partsList", weight: 25 }, { type: "illustration", weight: 75, slots: 1 }] }, { type: "disclaimer", weight: 10 }] },
      ctx
    )
    expect(root.children).toHaveLength(3)
    const composition = root.children[1]
    expect(composition.direction).toBe("column")
    expect(composition.children).toHaveLength(2)
    expect(composition.children[0].basis).toBeGreaterThan(composition.children[1].basis)
  })

  it("places one short color band below when that preserves more illustration area", () => {
    const root = interpretPagePlan(
      { id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "split", weight: 80, regions: [{ type: "colorSpecs", weight: 30 }, { type: "illustration", weight: 70, slots: 1 }] }, { type: "disclaimer", weight: 10 }] },
      ctx
    )
    expect(root.children).toHaveLength(3)
    expect(root.children[1].direction).toBe("column")
    expect(root.children[1].children[1].basis).toBeGreaterThan(0)
  })

  it("renders both columns of a split into the same page svg", () => {
    const pages = buildPlannedPages(
      { pages: [{ id: "split-page", title: "Split", purpose: "overview", regions: [{ type: "split", weight: 100, regions: [{ type: "partsList", weight: 40 }, { type: "illustration", weight: 60, slots: 1, refs: ["Frente"] }] }] }] },
      ctx
    )
    expect(pages[0].svg).toContain("Cuerpo") // partsList column
    expect(pages[0].svg).toContain("FRENTE") // illustration column
  })

  it("renders a grayscale document when { mono: true } - no brand hues survive", () => {
    const plan = { pages: [{ id: "p", title: "P", purpose: "overview", regions: [{ type: "titleBar", weight: 6 }, { type: "partsList", weight: 80 }, { type: "disclaimer", weight: 8 }] }] }
    const color = buildPlannedPages(plan, ctx)[0].svg
    const gray = buildPlannedPages(plan, ctx, { mono: true })[0].svg
    // the color version carries brand red/blue; the mono version carries neither
    expect(color).toContain("#E11D3A")
    expect(gray).not.toContain("#E11D3A")
    expect(gray).not.toContain("#1A3FB0")
    expect(gray).toContain("<svg")
    expect(gray).toContain("Cuerpo")
  })
})

describe("effectivePartsForPage (piece-aware pages)", () => {
  const parts = [
    { id: "body", val: "French terry", on: true },
    { id: "hood", val: "Doble capa", on: true },
    { id: "cuff", val: "Rib 2x2", on: true },
  ]

  it("returns every part when the page has no pieces field (e.g. a real overview)", () => {
    expect(effectivePartsForPage(parts, { id: "overview" })).toEqual(parts)
  })

  it("returns every part when pieces is an empty array", () => {
    expect(effectivePartsForPage(parts, { pieces: [] })).toEqual(parts)
  })

  it("narrows to only the ids a page lists", () => {
    const result = effectivePartsForPage(parts, { pieces: ["hood"] })
    expect(result).toEqual([{ id: "hood", val: "Doble capa", on: true }])
  })

  it("falls back to every part when none of the listed ids match anything real", () => {
    expect(effectivePartsForPage(parts, { pieces: ["nonexistent"] })).toEqual(parts)
  })
})

describe("buildPlannedPages parts-list pagination (F4.7)", () => {
  const manyParts = Array.from({ length: 40 }, (_, i) => ({ id: "p" + i, val: "Valor " + i, on: true }))
  const ctx = {
    lang: "ES",
    hdr: { brand: "Morfe", pname: "Hoodie" },
    parts: manyParts,
    designs: [],
    logo: null,
    txData: null,
    garment: { partLabels: { ES: {} } },
  }
  // A parts list given only a small split column - not nearly enough room
  // for 40 rows at the compact row height.
  const overflowPlan = {
    pages: [
      {
        id: "overview",
        title: "Estructura",
        purpose: "overview",
        regions: [
          { type: "header", weight: 8 },
          { type: "titleBar", weight: 5 },
          { type: "split", weight: 79, regions: [{ type: "partsList", weight: 100 }] },
          { type: "disclaimer", weight: 8 },
        ],
      },
    ],
  }

  it("splits an over-saturated parts list into continuation pages instead of dropping rows", () => {
    const pages = buildPlannedPages(overflowPlan, ctx)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0].name).toBe("overview")
    expect(pages[1].name).toContain("cont")
  })

  it("numbers continuation rows continuing from where the first page left off (no restart, no gap)", () => {
    const pages = buildPlannedPages(overflowPlan, ctx)
    const allText = pages.map((p) => p.svg).join("\n")
    // every one of the 40 parts' values must appear exactly once across the
    // whole paginated set - nothing lost, nothing duplicated. Matched as an
    // exact SVG text-node value (">Valor 1<") so "Valor 1" doesn't false-
    // positive against "Valor 10".."Valor 19" as a substring.
    manyParts.forEach((p) => {
      const needle = ">" + p.val + "<"
      const occurrences = allText.split(needle).length - 1
      expect(occurrences).toBe(1)
    })
  })

  it("does not paginate when the parts list actually fits its allotted space", () => {
    const smallCtx = { ...ctx, parts: manyParts.slice(0, 3) }
    const pages = buildPlannedPages(overflowPlan, smallCtx)
    expect(pages).toHaveLength(1)
  })
})

describe("buildPlannedPages design-table pagination", () => {
  const colors = Array.from({ length: 50 }, (_, index) => ({
    name: "Color " + (index + 1),
    hex: "#" + (index + 1).toString(16).padStart(6, "0"),
  }))
  const stopSeq = Array.from({ length: 60 }, (_, index) => ({ stop: index + 1, name: "Thread " + (index + 1), stitches: 1000 + index }))
  const ctx = {
    lang: "ES",
    hdr: { brand: "Morfe", pname: "Hoodie" },
    parts: [],
    designs: [{ name: "Dense", colors, emb: { machine: "Tajima", stitches: "60000", stopSeq } }],
  }
  const plan = { pages: [{
    id: "dense",
    title: "Dense design",
    purpose: "design:Dense",
    regions: [
      { type: "header" },
      { type: "titleBar" },
      { type: "illustration", slots: 1 },
      { type: "colorSpecs" },
      { type: "embSpecs" },
      { type: "disclaimer" },
    ],
  }] }

  it("continues colors and embroidery stops instead of clipping rows below their legible floor", () => {
    const pages = buildPlannedPages(plan, ctx)
    const allSvg = pages.map((item) => item.svg).join("\n")
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[1].name).toContain("data_cont")
    colors.forEach((color) => {
      const compact = allSvg.split(">" + color.name + "  " + color.hex + "<").length - 1
      const expanded = allSvg.split(">" + color.name + "<").length - 1
      expect(compact + expanded).toBe(1)
    })
    stopSeq.forEach((stop) => expect(allSvg.split(": " + stop.name + " (").length - 1).toBe(1))
  })
})

describe("Layout Engine v3 document assembly", () => {
  const ctx = {
    lang: "ES",
    hdr: { brand: "Morfe", pname: "Hoodie" },
    parts: [{ id: "body", val: "Cotton", on: true }],
    designs: [{
      name: "Chest",
      pos: "Pecho izquierdo",
      colors: [{ name: "Black", hex: "#111111" }],
      imageData: "aGVsbG8=",
      imageType: "png",
    }],
  }
  const plan = { pages: [
    { id: "cover", title: "Hoodie", purpose: "cover", regions: [{ type: "header" }, { type: "titleBar" }, { type: "illustration", slots: 1 }, { type: "disclaimer" }] },
    { id: "chest", title: "Chest", purpose: "design:Chest", regions: [{ type: "header" }, { type: "titleBar" }, { type: "illustration", slots: 1, briefs: [{ view: "Front", mustMark: ["neck seam"] }] }, { type: "colorSpecs" }, { type: "disclaimer" }] },
  ] }

  it("renders A4 handoff pages in two passes with index and stable numbering", () => {
    const pages = buildPlannedPages(plan, ctx, { documentMode: "illustration-handoff", includeIndex: true })
    expect(pages).toHaveLength(2)
    expect(pages.map((page) => [page.pageNumber, page.totalPages])).toEqual([[1, 2], [2, 2]])
    expect(pages[0].svg).toContain("INDICE DEL HANDOFF")
    expect(pages[0].svg).toContain("P. 01 / 02")
    expect(pages[1].svg).toContain("P. 02 / 02")
    expect(pages[1].svg).toContain("ILLUSTRATION HANDOFF - NO APROBADO PARA PRODUCCION")
  })

  it("emits editable references and per-slot instructions nested inside artwork", () => {
    const page = buildPlannedPages(plan, ctx, { documentMode: "illustration-handoff", includeIndex: true })[1]
    for (const id of ["ARTWORK", "TECH_DATA__COLORS", "ILLUSTRATOR_INSTRUCTIONS__V1", "REFERENCES", "PAGE_CHROME__HEADER"]) {
      expect(page.svg).toContain("id='" + id + "'")
    }
    const artworkStart = page.svg.indexOf("id='ARTWORK'")
    const instructionsStart = page.svg.indexOf("id='ILLUSTRATOR_INSTRUCTIONS__V1'")
    const artworkEnd = page.svg.indexOf("</g>", instructionsStart)
    expect(instructionsStart).toBeGreaterThan(artworkStart)
    expect(artworkEnd).toBeGreaterThan(instructionsStart)
    expect(page.svg).toContain("V1.1 neck seam")
    expect(page.svg).toContain("REFERENCIA - NO A ESCALA")
    const fontSizes = [...page.svg.matchAll(/font-size='([\d.]+)'/g)].map((match) => Number(match[1]))
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(10)
  })

  it("migrates a legacy instruction region into its illustration without retaining a layout block", () => {
    const normalized = normalizePlan({ pages: [{
      id: "legacy",
      regions: [
        { type: "illustration", slots: 1 },
        { type: "artworkInstructions", briefs: [{ view: "Front", mustMark: ["zipper"] }] },
      ],
    }] })
    expect(normalized.pages[0].regions.map((region) => region.type)).toEqual(["illustration"])
    expect(normalized.pages[0].regions[0].briefs[0].mustMark).toEqual(["zipper"])
  })

  it("inserts a cover-index when a fallback plan omitted the cover", () => {
    const pages = buildPlannedPages({ pages: [plan.pages[1]] }, ctx, { documentMode: "illustration-handoff", includeIndex: true })
    expect(pages[0].purpose).toBe("cover")
    expect(pages[0].svg).toContain("INDICE DEL HANDOFF")
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[1].totalPages).toBe(2)
  })
})
