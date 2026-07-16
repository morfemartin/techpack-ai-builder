// Deterministic interpreter for the AI-authored document plan (F4.1).
//
// The AI emits a declarative plan - an ordered list of pages, each a list of
// regions drawn from a CLOSED vocabulary, each region carrying a `weight`
// (how much of the page's height it should take) plus optional role/slots/
// refs/note. This module never trusts that plan blindly: `normalizePlan`
// sanitizes whatever the model returns into an always-valid shape, and
// `weightsToGrow` maps the human-friendly weights onto the flexbox solver's
// `grow` values. Both are pure so they're trivial to unit-test without the
// layout engine or a DeepSeek call.

import { T } from "../core/i18n.js"
import { R, TX, svgHeader, svgDisc, wrapLines } from "../core/svgPrimitives.js"
import { row, col, leaf, solveLayout, renderLayoutToSVG } from "../layout/index.js"
import { palette } from "../design/tokens.js"
import { INSET, ROW } from "../design/metrics.js"
import { toGrayscale } from "../core/colorUtils.js"
import { renderColorSpecs, renderEmbSpecs, renderIllustrationZone, renderPartsList } from "./buildPages.js"

// The only LEAF region types the interpreter knows how to render. Anything else
// the model invents is dropped by normalizePlan rather than risking a broken
// page. `split` (below) is a COMPOSITE, handled separately: it is not a leaf.
export const VOCAB = ["header", "titleBar", "illustration", "partsList", "colorSpecs", "embSpecs", "note", "spacer", "disclaimer"]

// Fixed print canvas size - matches buildPages.js's hardcoded 1200x900 for the
// non-AI-planned pages, so a page reads the same regardless of which builder
// made it. Hoisted here (not just local to buildPlannedPages) because the
// content-aware split compositor below needs it to estimate a region's
// allotted height WITHOUT running a full solve pass first.
const PAGE_W = 1200
const PAGE_H = 900

// Page-level breathing room: a consistent outer margin + gutter between bands is
// what turns a stack of blocks into a *composed* page instead of bands welded to
// the frame edge. Percent-free px because the solver already resolves them.
const PAGE_PAD = 26
const PAGE_GAP = 14
// Gutter between the columns of a `split` (side-by-side) region.
const SPLIT_GAP = 14

// Structural blocks are chrome, not content: a real tech pack keeps the header,
// the section title, and the disclaimer as THIN, FIXED strips and lets the
// illustration / data grow to fill everything left over. Fixing their height
// (instead of letting a model weight bloat them) is what kills the oversized
// blue title bar and the dead whitespace at the bottom of a page in one move -
// the model's weights now only distribute the CONTENT area.
const FIXED_BASIS = { header: 82, titleBar: 30, disclaimer: 20 }

// Matches renderPartsList's `compact` row basis plus its table header (both
// from the shared metrics scale) - used to measure, after solving, whether a
// page's parts list actually fits the parts assigned to it (see
// `buildPlannedPages` pagination).
const COMPACT_ROW_H = ROW.table
const TABLE_HEADER_H = ROW.tableHeader
function partsCapacity(height) {
  return Math.max(0, Math.floor((height - TABLE_HEADER_H) / COMPACT_ROW_H))
}

// A real technical designer doesn't repeat the whole BOM on every page - a
// page about the hood shows the hood's pieces, not the zipper's. `page.pieces`
// (an array of part ids the outline pass assigns per page) narrows the parts
// list down to what THIS page is actually about. Falls back to every part
// when a page doesn't specify pieces (e.g. a genuine overview) or when none
// of the given ids match anything real, so a bad id never produces an empty
// table.
export function effectivePartsForPage(allParts, page) {
  const all = Array.isArray(allParts) ? allParts : []
  const wanted = page && Array.isArray(page.pieces) ? page.pieces.filter((x) => typeof x === "string" && x.trim()) : []
  if (wanted.length === 0) return all
  const ids = wanted.map(String)
  const filtered = all.filter((p) => p && ids.indexOf(String(p.id)) !== -1)
  return filtered.length > 0 ? filtered : all
}

// A page that lost all its regions still needs to render something sane.
const FALLBACK_REGIONS = [
  { type: "header", weight: 12 },
  { type: "disclaimer", weight: 12 },
]

// Used when the whole plan is unusable (not an object, no pages, etc.).
function fallbackPlan() {
  return {
    pages: [
      {
        id: "page-1",
        title: "Documento",
        purpose: "overview",
        regions: [
          { type: "header", weight: 12 },
          { type: "partsList", weight: 76 },
          { type: "disclaimer", weight: 12 },
        ],
      },
    ],
  }
}

function safeWeight(w) {
  return typeof w === "number" && isFinite(w) && w > 0 ? w : 1
}

// Estimates each top-level region's allotted pixel height WITHOUT running a
// full solve pass - a plain replay of solveLayout's own column math (fixed
// bases subtracted first, remainder split by grow proportion among the
// non-fixed regions), since the page's geometry (PAGE_H, PAGE_PAD, PAGE_GAP,
// FIXED_BASIS) is entirely known ahead of time. This is what lets the split
// compositor below decide row-vs-stack BEFORE building the tree, instead of
// solving twice.
function estimateRegionHeights(regions, grows) {
  const n = regions.length
  const totalGapPx = PAGE_GAP * Math.max(0, n - 1)
  const fixedTotal = regions.reduce((sum, r) => sum + (FIXED_BASIS[r.type] || 0), 0)
  const available = Math.max(0, PAGE_H - PAGE_PAD * 2 - totalGapPx - fixedTotal)
  const growSum = regions.reduce((sum, r, i) => sum + (FIXED_BASIS[r.type] ? 0 : grows[i]), 0)
  return regions.map((r, i) => (FIXED_BASIS[r.type] ? FIXED_BASIS[r.type] : growSum > 0 ? available * (grows[i] / growSum) : 0))
}

// The ideal (uncompressed) content height a bounded region NEEDS, as a pure
// function of its data volume - independent of whatever width/height a split
// column would otherwise stretch it into. Mirrors the row-height constants
// each renderer already uses at its own "plenty of room" ceiling (compact
// partsList rows, colorSpecs's ideal 30px row, embSpecs's ideal 16px row) so
// the estimate and the actual render agree. Returns null for a region type
// this can't be measured for (illustration, note, spacer, ...) - those always
// stretch to fill whatever they're given, so they're never the "short" side
// of a split.
function naturalContentHeight(region, page, ctx) {
  if (region.type === "partsList") {
    const parts = (ctx && ctx.parts) || []
    const n = parts.filter((p) => p && p.on !== false).length
    return TABLE_HEADER_H + n * COMPACT_ROW_H
  }
  if (region.type === "colorSpecs") {
    const design = selectedDesign(page, ctx)
    const n = ((design && design.colors) || []).filter((c) => c && c.hex).length
    return n > 0 ? 34 + n * 30 : 0
  }
  if (region.type === "embSpecs") {
    const design = selectedDesign(page, ctx)
    const emb = design && design.emb
    if (!emb) return 0
    const fieldCount = 14 // matches the fixed `er` field list in renderEmbSpecs
    const seqLen = emb.stopSeq && emb.stopSeq.length > 0 ? emb.stopSeq.length : 0
    return 34 + (fieldCount + (seqLen > 0 ? 1 + seqLen : 0)) * 16
  }
  return null
}

// A bounded content block gets stacked below the illustration (instead of
// stretched into a side column) only when it needs meaningfully less than
// half of what the split was allotted - short of that, a side-by-side split
// still reads as a deliberate two-column composition, not empty space.
const STACK_MAX_RATIO = 0.5
const STACK_CONTENT_PAD = 16

// Only these content types stack below the illustration when short. The key
// distinction is HORIZONTAL fill: a partsList row is a wide 3-column record
// (#/spec/detail) that reads well stretched to the full page width, so a
// short parts list becomes a clean full-width strip under the illustration.
// A colorSpecs card and an embSpecs sheet are the opposite - narrow, left-
// weighted content (a swatch + a line, a label:value pair). Stacking those
// full-width just moves the dead space from *below* a side column to the
// *right* of a wide band, which looks worse - a color card reads as designed
// as a side column even with some room beneath it. So color/emb specs stay
// side-by-side (their tech-pack idiom); only partsList reflows to a stack.
// See docs/layout-lab for the visual before/after that drove this rule.
const STACKABLE_TYPES = new Set(["partsList"])

// Normalizes region weights into flex `grow` values that sum to 100, keeping
// their proportions. A missing/invalid/non-positive weight counts as 1 (the
// minimum share) so a region is never allotted zero height by accident.
export function weightsToGrow(regions) {
  if (!Array.isArray(regions) || regions.length === 0) return []
  const weights = regions.map((r) => safeWeight(r && r.weight))
  const total = weights.reduce((a, w) => a + w, 0)
  return weights.map((w) => (w / total) * 100)
}

// Sanitizes a single region without mutating it. Returns null for anything the
// interpreter can't render, so the caller can filter it out. A `split` is kept
// only if at least one of its inner leaf regions survives - an empty split would
// render as a blank row, so it's dropped like any other unusable region.
function normalizeRegion(r) {
  if (!r || typeof r !== "object") return null
  if (r.type === "split") {
    const inner = (Array.isArray(r.regions) ? r.regions : [])
      .filter((c) => c && typeof c === "object" && VOCAB.includes(c.type))
      .map((c) => ({ ...c, weight: safeWeight(c.weight) }))
    if (inner.length === 0) return null
    return { ...r, type: "split", weight: safeWeight(r.weight), regions: inner }
  }
  if (VOCAB.includes(r.type)) return { ...r, weight: safeWeight(r.weight) }
  return null
}

// Turns whatever the model returned into an always-valid plan, without
// mutating the input. Unknown region types are dropped; a page emptied by that
// filtering falls back to a minimal header+disclaimer so it still renders;
// an unusable top-level shape falls back to a single overview page.
export function normalizePlan(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages) || raw.pages.length === 0) return fallbackPlan()

  const pages = raw.pages.map((page, i) => {
    const p = page && typeof page === "object" ? page : {}
    const id = typeof p.id === "string" && p.id.length > 0 ? p.id : "page-" + (i + 1)
    const title = typeof p.title === "string" ? p.title : ""
    const purpose = typeof p.purpose === "string" ? p.purpose : "overview"

    let regions = Array.isArray(p.regions) ? p.regions : []
    regions = regions.map(normalizeRegion).filter(Boolean)
    if (regions.length === 0) regions = FALLBACK_REGIONS.map((r) => ({ ...r }))

    const pieces = Array.isArray(p.pieces) ? p.pieces.filter((x) => typeof x === "string" && x.trim()) : undefined

    return { id, title, purpose, pieces, regions }
  })

  return { pages }
}

function selectedDesign(page, ctx) {
  const designs = ctx && Array.isArray(ctx.designs) ? ctx.designs : []
  if (designs.length === 0) return null
  const purpose = page && typeof page.purpose === "string" ? page.purpose : ""
  const token = purpose.startsWith("design:") ? purpose.slice("design:".length).trim() : ""
  const cover = page && Array.isArray(page.covers) && page.covers.length > 0 ? String(page.covers[0]).trim() : ""
  const key = token || cover
  if (!key) return designs[0]

  const numeric = Number(key)
  if (Number.isInteger(numeric)) {
    if (designs[numeric]) return designs[numeric]
    if (designs[numeric - 1]) return designs[numeric - 1]
  }

  const needle = key.toLowerCase()
  return designs.find((d) => d && typeof d.name === "string" && d.name.toLowerCase() === needle) || designs[0]
}

function renderNote(box, text) {
  const note = text || ""
  const accent = 4
  let s = R(box.x, box.y, box.width, box.height, palette.white.hex, palette.ink.hex, "0.8")
  s += R(box.x, box.y, accent, box.height, palette.yellow.hex, palette.yellow.hex, "0")
  const textX = box.x + accent + INSET
  const lines = wrapLines(note, Math.max(1, box.width - (accent + INSET * 2)), 10)
  lines.slice(0, Math.max(1, Math.floor((box.height - 16) / 14))).forEach((line, i) => {
    s += TX(textX, box.y + 12 + i * 14, line, 10, false, "start")
  })
  return s
}

function leafForRegion(region, page, ctx) {
  const t = T[(ctx && ctx.lang) || "ES"] || T.ES
  const design = selectedDesign(page, ctx)
  const garment = ctx && ctx.garment ? ctx.garment : null
  const partLabels = garment && garment.partLabels ? garment.partLabels[(ctx && ctx.lang) || "ES"] || garment.partLabels.ES || {} : {}
  const txData = ctx && ctx.txData ? ctx.txData : null
  const hdr = ctx && ctx.hdr ? ctx.hdr : {}

  // Structural chrome takes a fixed height; content blocks grow by their weight.
  var fixed = FIXED_BASIS[region.type]
  var sizing = fixed ? { basis: fixed, grow: 0, shrink: 0 } : { grow: region.grow }
  return leaf({
    ...sizing,
    min: region.type === "spacer" ? 0 : 20,
    // Tags this leaf so buildPlannedPages can find it post-solve and read its
    // ALLOTTED height - the box height depends only on the plan's weights,
    // never on how many parts are shown, so it's a stable measuring stick for
    // "does this page's part count actually fit here" (see partsCapacity).
    _isPartsList: region.type === "partsList",
    render: (box) => {
      if (region.type === "header") {
        return "<g transform='translate(" + box.x + " " + box.y + ")'>" + svgHeader(hdr, ctx && ctx.logo, box.width, box.height) + "</g>"
      }
      if (region.type === "titleBar") {
        // Asymmetric Bauhaus title: a solid role.index red block anchors the
        // left edge (a pure geometric mark, no number needed), then the title
        // sits LEFT-aligned in tracked caps-lineage type on the blue field -
        // Bill/Bayer, not a centered <h1>. Left-alignment + the red anchor are
        // what read as "designed" versus the old centered bar.
        var title = page.title || page.purpose || ""
        var sq = Math.min(box.height, 30)
        var s = R(box.x, box.y, box.width, box.height, palette.blue.hex, palette.ink.hex, "0.8")
        s += R(box.x, box.y, sq, box.height, palette.red.hex, palette.red.hex, "0")
        s += TX(box.x + sq + INSET, box.y + box.height / 2, title, 12, true, "start", palette.white.hex, undefined, 0.6)
        return s
      }
      if (region.type === "illustration") {
        return renderIllustrationZone(box, { slots: region.slots, refs: region.refs, note: region.note || (design && design.illustrationBrief) || "" })
      }
      if (region.type === "partsList") {
        // ctx.parts already reflects this page's pieces (see interpretPagePlan)
        // and, for a paginated continuation page, the exact remaining slice.
        return renderPartsList(box, {
          parts: (ctx && ctx.parts) || [],
          partLabels,
          txParts: txData && txData.parts,
          labels: { spec: t.sp, detail: t.dt },
          compact: true,
          startIndex: (ctx && ctx.partsStartIndex) || 0,
        })
      }
      if (region.type === "colorSpecs") return renderColorSpecs(box, { colors: design && design.colors })
      if (region.type === "embSpecs") return renderEmbSpecs(box, { emb: design && design.emb, title: t.embTitle })
      if (region.type === "note") return renderNote(box, region.note || page.purpose || "")
      if (region.type === "disclaimer") return svgDisc(t, hdr, box.width, box.y, box.height)
      return ""
    },
  })
}

// Maps one normalized region to a layout node. A `split` normally becomes a
// horizontal `row` whose children are its inner leaf regions, each given a
// horizontal grow from its own weight - this is what lets a page place a
// narrow numbered partsList beside a wide illustration (the real tech-pack
// idiom). But when the split pairs an illustration with a SHORT parts list,
// stretching that table into a full-height side column just to match the
// illustration is the "lateral layout with dead white space" the model can't
// reason about on its own - so when `allottedHeight` shows the table needs
// far less than its column would give it, this stacks instead: illustration
// on top (full width, most of the height), the table below at its own natural
// height as a full-width strip. Restricted to STACKABLE_TYPES (partsList) -
// see that constant for why color/emb specs stay side columns. Everything
// else stays a leaf.
function buildRegionNode(region, page, ctx, allottedHeight) {
  if (region.type === "split") {
    const inner = Array.isArray(region.regions) ? region.regions : []

    if (inner.length === 2 && allottedHeight) {
      const illuIdx = inner.findIndex((r) => r.type === "illustration")
      const otherIdx = illuIdx === 0 ? 1 : illuIdx === 1 ? 0 : -1
      if (illuIdx !== -1 && otherIdx !== -1 && STACKABLE_TYPES.has(inner[otherIdx].type)) {
        const natural = naturalContentHeight(inner[otherIdx], page, ctx)
        if (natural !== null && natural > 0 && natural < allottedHeight * STACK_MAX_RATIO) {
          const contentLeaf = { ...leafForRegion({ ...inner[otherIdx], grow: 0 }, page, ctx), basis: natural + STACK_CONTENT_PAD, grow: 0, shrink: 0 }
          const illuLeaf = { ...leafForRegion({ ...inner[illuIdx], grow: 1 }, page, ctx), basis: "auto", grow: 1 }
          // Illustration always on top regardless of the AI's original inner
          // order - it's the hero and the one region that benefits from
          // reclaiming the freed height, the content block is a caption below it.
          return col({ grow: region.grow, gap: SPLIT_GAP }, [illuLeaf, contentLeaf])
        }
      }
    }

    const grows = weightsToGrow(inner)
    const children = inner.map((r, i) => leafForRegion({ ...r, grow: grows[i] }, page, ctx))
    return row({ grow: region.grow, gap: SPLIT_GAP }, children)
  }
  return leafForRegion(region, page, ctx)
}

export function interpretPagePlan(page, ctx) {
  const normalized = normalizePlan({ pages: [page] }).pages[0]
  const grows = weightsToGrow(normalized.regions)
  const heights = estimateRegionHeights(normalized.regions, grows)
  const regions = normalized.regions.map((region, i) => ({ ...region, grow: grows[i] }))
  const safeCtx = ctx || {}
  // Piece-aware narrowing happens ONCE here, so both a direct interpretPagePlan
  // call (tests) and the full buildPlannedPages path share one source of truth
  // for "which parts does this page actually show."
  const pageCtx = { ...safeCtx, parts: effectivePartsForPage(safeCtx.parts, normalized) }
  return col({ padding: PAGE_PAD, gap: PAGE_GAP }, regions.map((region, i) => buildRegionNode(region, normalized, pageCtx, heights[i])))
}

function pageName(page, i) {
  const base = page.id || page.title || "page-" + (i + 1)
  return String(base).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "page_" + (i + 1)
}

// Depth-first search for the leaf tagged by leafForRegion as the page's parts
// list, so its ALLOTTED box height (a pure function of the plan's weights,
// not of how many parts exist) can be read after solving.
function findPartsListLeaf(node) {
  if (!node) return null
  if (node._isPartsList) return node
  if (node.children) {
    for (const c of node.children) {
      const found = findPartsListLeaf(c)
      if (found) return found
    }
  }
  return null
}

export function buildPlannedPages(plan, ctx, opts) {
  const mono = !!(opts && opts.mono)
  const normalized = normalizePlan(plan)
  const W = PAGE_W
  const H = PAGE_H
  const allParts = (ctx && ctx.parts) || []

  function resolvedTreeFor(page, pageCtx) {
    return solveLayout(interpretPagePlan(page, pageCtx), { x: 0, y: 0, width: W, height: H })
  }
  function svgFor(resolved) {
    let svg = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'>"
    svg += "<rect width='" + W + "' height='" + H + "' fill='" + palette.white.hex + "' stroke='" + palette.ink.hex + "' stroke-width='1.5'/>"
    svg += renderLayoutToSVG(resolved)
    svg += "</svg>"
    // Grayscale is a pure post-process on the finished page (see toGrayscale) -
    // no renderer needs a parallel "mono" path.
    return mono ? toGrayscale(svg) : svg
  }

  const outPages = []

  normalized.pages.forEach((page, i) => {
    const firstPass = resolvedTreeFor(page, ctx)
    const partsLeaf = findPartsListLeaf(firstPass)
    const effective = effectivePartsForPage(allParts, page)

    if (!partsLeaf || effective.length <= partsCapacity(partsLeaf.height)) {
      outPages.push({ name: pageName(page, i), svg: svgFor(firstPass) })
      return
    }

    // Overflow: the plan gave this page's parts list less room than its real
    // piece count needs. A real designer wouldn't shrink the text to the
    // point of illegibility or silently lose rows - they'd split the table
    // across a "(cont.)" page, numbering continuing so it still reads as one
    // BOM. Every other block already shrinks-to-fit (fitText, dynamic specs
    // row height); the parts list is the one place row height is fixed for
    // readability, so it's the one that paginates instead.
    const cap = Math.max(1, partsCapacity(partsLeaf.height))
    const cappedCtx = { ...ctx, parts: effective.slice(0, cap), partsStartIndex: 0 }
    outPages.push({ name: pageName(page, i), svg: svgFor(resolvedTreeFor({ ...page, pieces: undefined }, cappedCtx)) })

    let rest = effective.slice(cap)
    let startIndex = cap
    let contN = 1
    while (rest.length > 0) {
      const contPage = {
        id: page.id + "-cont-" + contN,
        title: (page.title || "") + " (cont.)",
        purpose: page.purpose,
        regions: [
          { type: "header", weight: 8 },
          { type: "titleBar", weight: 5 },
          { type: "partsList", weight: 79 },
          { type: "disclaimer", weight: 8 },
        ],
      }
      const probe = resolvedTreeFor(contPage, { ...ctx, parts: rest, partsStartIndex: startIndex })
      const contLeaf = findPartsListLeaf(probe)
      const contCap = Math.max(1, partsCapacity(contLeaf ? contLeaf.height : H))
      const chunk = rest.slice(0, contCap)
      const final = chunk.length === rest.length ? probe : resolvedTreeFor(contPage, { ...ctx, parts: chunk, partsStartIndex: startIndex })
      outPages.push({ name: pageName(contPage, i), svg: svgFor(final) })
      rest = rest.slice(contCap)
      startIndex += contCap
      contN++
    }
  })

  return outPages
}
