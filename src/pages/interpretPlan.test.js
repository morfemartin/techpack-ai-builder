import { describe, it, expect } from "vitest"
import { VOCAB, buildPlannedPages, effectivePartsForPage, interpretPagePlan, normalizePlan, weightsToGrow } from "./interpretPlan.js"

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
    expect(root.children[0].basis).toBe(82)
    // partsList: bounded content at its natural height (1 part = 20 header
    // strip + 32 table row), never stretched by the plan weight anymore
    expect(root.children[1].grow).toBe(0)
    expect(root.children[1].basis).toBe(52)
    // slack spacer: the only growing node
    expect(root.children[2].grow).toBe(1)
    // disclaimer: fixed strip, pinned to the bottom
    expect(root.children[3].grow).toBe(0)
    expect(root.children[3].basis).toBe(20)
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
    expect(root.children).toHaveLength(4) // no spacer injected - the illustration absorbs
    const note = root.children[1]
    const illustration = root.children[2]
    // note: bounded at its wrapped-text natural height (a short line ≈ 30px), grow 0
    expect(note.grow).toBe(0)
    expect(note.basis).toBeLessThan(60)
    expect(note.basis).toBeGreaterThan(0)
    // illustration: the absorber - the only grower on the page
    expect(illustration.grow).toBeGreaterThan(0)
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

  it("builds a horizontal row for a split when the content column has enough real content to fill it", () => {
    // 12 parts rows (20 + 12*30 = 380px natural) is comfortably more than
    // half of this split's ~718px allotted share of the page, so a real
    // side-by-side split still reads as intentional here, not whitespace.
    const fullCtx = { ...ctx, parts: Array.from({ length: 12 }, (_, i) => ({ id: "p" + i, val: "Valor " + i, on: true })) }
    const root = interpretPagePlan(
      { id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "split", weight: 80, regions: [{ type: "partsList", weight: 25 }, { type: "illustration", weight: 75, slots: 1 }] }, { type: "disclaimer", weight: 10 }] },
      fullCtx
    )
    expect(root.children).toHaveLength(3)
    const splitNode = root.children[1]
    expect(splitNode.direction).toBe("row")
    expect(splitNode.children).toHaveLength(2)
    expect(splitNode.children[0].grow).toBe(25)
    expect(splitNode.children[1].grow).toBe(75)
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
    const splitNode = root.children[1]
    expect(splitNode.direction).toBe("column")
    expect(splitNode.children).toHaveLength(2)
    // illustration first (on top), grows to fill whatever height is freed up
    expect(splitNode.children[0].grow).toBe(1)
    // the parts list sits below, sized to its own natural height - not
    // stretched: 20px table header + 1 row * 32px (ROW.table) + 16px pad = 68px
    expect(splitNode.children[1].grow).toBe(0)
    expect(splitNode.children[1].basis).toBe(68)
  })

  // Counterpart to the stack rule: only a partsList reflows to a full-width
  // strip. A colorSpecs card is narrow, left-weighted content - stacking it
  // full-width would move the dead space to the RIGHT of a wide band, which
  // looks worse, so it stays a side column even when short (see the
  // STACKABLE_TYPES decision + docs/layout-lab before/after). Here the single
  // color would trip the height threshold if it were stackable; assert it
  // still resolves to a side-by-side row.
  it("keeps colorSpecs as a side-by-side column even when short (does NOT stack full-width)", () => {
    const root = interpretPagePlan(
      { id: "p", title: "P", purpose: "overview", regions: [{ type: "header", weight: 10 }, { type: "split", weight: 80, regions: [{ type: "colorSpecs", weight: 30 }, { type: "illustration", weight: 70, slots: 1 }] }, { type: "disclaimer", weight: 10 }] },
      ctx
    )
    const splitNode = root.children[1]
    expect(splitNode.direction).toBe("row")
    expect(splitNode.children).toHaveLength(2)
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
  const manyParts = Array.from({ length: 30 }, (_, i) => ({ id: "p" + i, val: "Valor " + i, on: true }))
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
  // for 30 rows at the fixed compact row height.
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
    // every one of the 30 parts' values must appear exactly once across the
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
