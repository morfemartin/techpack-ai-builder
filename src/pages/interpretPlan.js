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
import { R, TX, sv, svgHeader, svgDisc, wrapLines } from "../core/svgPrimitives.js"
import { row, col, leaf, solveLayout, renderLayoutToSVG } from "../layout/index.js"
import { palette, type } from "../design/tokens.js"
import { toGrayscale } from "../core/colorUtils.js"
import { renderColorSpecs, renderEmbSpecs, renderIllustrationZone, renderPartsList } from "./buildPages.js"

// The only LEAF region types the interpreter knows how to render. Anything else
// the model invents is dropped by normalizePlan rather than risking a broken
// page. `split` (below) is a COMPOSITE, handled separately: it is not a leaf.
export const VOCAB = ["header", "titleBar", "illustration", "partsList", "colorSpecs", "embSpecs", "note", "spacer", "disclaimer"]

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
const FIXED_BASIS = { header: 82, titleBar: 30, disclaimer: 30 }

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

    return { id, title, purpose, regions }
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
  let s = R(box.x, box.y, box.width, box.height, palette.white.hex, palette.ink.hex, "0.8")
  s += R(box.x, box.y, 4, box.height, palette.yellow.hex, palette.yellow.hex, "0")
  const lines = wrapLines(note, Math.max(1, box.width - 24), 10)
  lines.slice(0, Math.max(1, Math.floor((box.height - 16) / 14))).forEach((line, i) => {
    s += TX(box.x + 14, box.y + 12 + i * 14, line, 10, false, "start")
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
        var tx = box.x + sq + 14
        s += "<text x='" + tx + "' y='" + (box.y + box.height / 2) + "' text-anchor='start' dominant-baseline='central' font-family='" + type.svgFonts.ui + "' font-size='12' font-weight='bold' letter-spacing='0.6' fill='" + palette.white.hex + "'>" + sv(title) + "</text>"
        return s
      }
      if (region.type === "illustration") {
        return renderIllustrationZone(box, { slots: region.slots, refs: region.refs, note: region.note || (design && design.illustrationBrief) || "" })
      }
      if (region.type === "partsList") {
        return renderPartsList(box, {
          parts: (ctx && ctx.parts) || [],
          partLabels,
          txParts: txData && txData.parts,
          labels: { spec: t.sp, detail: t.dt, file: "Archivo / Drive" },
          compact: true,
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

// Maps one normalized region to a layout node. A `split` becomes a horizontal
// `row` whose children are its inner leaf regions, each given a horizontal grow
// from its own weight - this is what lets a page place a narrow numbered
// partsList beside a wide illustration (the real tech-pack idiom) instead of
// forcing every block into a full-width band. Everything else stays a leaf.
function buildRegionNode(region, page, ctx) {
  if (region.type === "split") {
    const inner = Array.isArray(region.regions) ? region.regions : []
    const grows = weightsToGrow(inner)
    const children = inner.map((r, i) => leafForRegion({ ...r, grow: grows[i] }, page, ctx))
    return row({ grow: region.grow, gap: SPLIT_GAP }, children)
  }
  return leafForRegion(region, page, ctx)
}

export function interpretPagePlan(page, ctx) {
  const normalized = normalizePlan({ pages: [page] }).pages[0]
  const grows = weightsToGrow(normalized.regions)
  const regions = normalized.regions.map((region, i) => ({ ...region, grow: grows[i] }))
  return col({ padding: PAGE_PAD, gap: PAGE_GAP }, regions.map((region) => buildRegionNode(region, normalized, ctx || {})))
}

function pageName(page, i) {
  const base = page.id || page.title || "page-" + (i + 1)
  return String(base).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "page_" + (i + 1)
}

export function buildPlannedPages(plan, ctx, opts) {
  const mono = !!(opts && opts.mono)
  const normalized = normalizePlan(plan)
  const W = 1200
  const H = 900
  return normalized.pages.map((page, i) => {
    const root = interpretPagePlan(page, ctx)
    const resolved = solveLayout(root, { x: 0, y: 0, width: W, height: H })
    let svg = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'>"
    svg += "<rect width='" + W + "' height='" + H + "' fill='" + palette.white.hex + "' stroke='" + palette.ink.hex + "' stroke-width='1.5'/>"
    svg += renderLayoutToSVG(resolved)
    svg += "</svg>"
    // Grayscale is a pure post-process on the finished page (see toGrayscale) -
    // no renderer needs a parallel "mono" path.
    if (mono) svg = toGrayscale(svg)
    return { name: pageName(page, i), svg }
  })
}
