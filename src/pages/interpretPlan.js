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
import { R, TX, svgHeader, svgDisc, wrapLines, fitText, headerHeight } from "../core/svgPrimitives.js"
import { row, col, leaf, solveLayout, renderLayoutToSVG } from "../layout/index.js"
import { palette } from "../design/tokens.js"
import { CHROME, GRID, INSET, PAGE, PAGE_BODY, PRINT } from "../design/metrics.js"
import { toGrayscale } from "../core/colorUtils.js"
import { documentIndexRows, measureRegion, selectedDesign } from "./measure.js"
import { normalizeSlotBriefs } from "./briefs.js"
import { renderColorSpecs, renderEmbSpecs, renderIllustrationZone, renderPartsList, renderReferenceAsset } from "./buildPages.js"
import { optimizePageComposition } from "./composition.js"
import { partsCapacityForHeight } from "./tableMetrics.js"

// The only LEAF region types the interpreter knows how to render. Anything else
// the model invents is dropped by normalizePlan rather than risking a broken
// page. `split` (below) is a COMPOSITE, handled separately: it is not a leaf.
export const VOCAB = ["header", "titleBar", "illustration", "partsList", "colorSpecs", "embSpecs", "references", "documentIndex", "note", "spacer", "disclaimer"]

// Shared A4 print canvas, so a page reads the same regardless of which builder
// made it. Hoisted here (not just local to buildPlannedPages) because the
// content-aware split compositor below needs it to estimate a region's
// allotted height WITHOUT running a full solve pass first.
const PAGE_W = PAGE.width
const PAGE_H = PAGE.height

// Page-level breathing room: a consistent outer margin + gutter between bands is
// what turns a stack of blocks into a *composed* page instead of bands welded to
// the frame edge. Percent-free px because the solver already resolves them.
const PAGE_PAD = GRID.margin
const PAGE_GAP = CHROME.gap
// Gutter between the columns of a `split` (side-by-side) region.
const SPLIT_GAP = GRID.gutter

// Structural blocks are chrome, not content: a real tech pack keeps the header,
// the section title, and the disclaimer as THIN, FIXED strips and lets the
// illustration / data grow to fill everything left over. Fixing their height
// (instead of letting a model weight bloat them) is what kills the oversized
// blue title bar and the dead whitespace at the bottom of a page in one move -
// the model's weights now only distribute the CONTENT area.
const FIXED_BASIS = { titleBar: CHROME.titleBar, disclaimer: CHROME.footer }
const STANDARD_WORKING_HEIGHT = PAGE_BODY.height

function workingHeight(ctx) {
  return STANDARD_WORKING_HEIGHT - Math.max(0, headerHeight(ctx && ctx.hdr, CONTENT_W) - CHROME.header)
}

// Matches renderPartsList's `compact` row basis plus its table header (both
// from the shared metrics scale) - used to measure, after solving, whether a
// page's parts list actually fits the parts assigned to it (see
// `buildPlannedPages` pagination).
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

// Content width available to a page's top-level regions.
const CONTENT_W = PAGE_W - PAGE_PAD * 2

// Measures a top-level node, treating a `split` as the composition it is:
// side-by-side columns are as tall as their TALLEST column wants to be, and
// a split absorbs page slack whenever ANY of its columns absorbs (the usual
// case - a data column beside an illustration column). Leaf regions defer to
// the shared measure registry (measure.js), the same numbers the renderers
// draw with.
function measureNode(region, page, ctx, width) {
  if (region.type === "split") {
    const inner = Array.isArray(region.regions) ? region.regions : []
    const innerW = width / Math.max(1, inner.length)
    const ms = inner.map((r) => measureRegion(r, page, ctx, innerW))
    if (ms.some((m) => m.canAbsorb)) {
      return { natural: null, min: Math.max(120, ...ms.map((m) => m.min)), canAbsorb: true }
    }
    return { natural: Math.max(0, ...ms.map((m) => m.natural || 0)), min: Math.max(0, ...ms.map((m) => m.min)), canAbsorb: false }
  }
  return measureRegion(region, page, ctx, width)
}

// Estimates each top-level region's allotted pixel height WITHOUT running a
// full solve pass, mirroring the measure-then-solve sizing below: fixed
// chrome takes its strip, bounded regions take their measured natural
// height, and the remainder goes to the absorbers in proportion to their
// plan weights. This is what lets the split compositor decide row-vs-stack
// BEFORE building the tree, instead of solving twice.
function estimateRegionHeights(regions, grows, page, ctx) {
  const n = regions.length
  const totalGapPx = PAGE_GAP * Math.max(0, n - 1)
  const measures = regions.map((r) => measureNode(r, page, ctx, CONTENT_W))
  let consumed = 0
  let absorberGrow = 0
  regions.forEach((r, i) => {
    if (FIXED_BASIS[r.type]) consumed += FIXED_BASIS[r.type]
    else if (measures[i].canAbsorb) absorberGrow += grows[i]
    else consumed += measures[i].natural || 0
  })
  const slack = Math.max(0, PAGE_H - PAGE_PAD * 2 - totalGapPx - consumed)
  return regions.map((r, i) => {
    if (FIXED_BASIS[r.type]) return FIXED_BASIS[r.type]
    if (measures[i].canAbsorb) return absorberGrow > 0 ? slack * (grows[i] / absorberGrow) : slack
    return measures[i].natural || 0
  })
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

function instructionBriefs(regions) {
  for (const region of Array.isArray(regions) ? regions : []) {
    if (region && region.type === "artworkInstructions" && Array.isArray(region.briefs)) return region.briefs
    if (region && region.type === "split") {
      const nested = instructionBriefs(region.regions)
      if (nested) return nested
    }
  }
  return null
}

function attachBriefsToIllustration(regions, briefs) {
  if (!Array.isArray(briefs) || briefs.length === 0) return regions
  let attached = false
  function visit(region) {
    if (!region || attached) return region
    if (region.type === "illustration") {
      attached = true
      return Array.isArray(region.briefs) && region.briefs.length > 0 ? region : { ...region, briefs }
    }
    if (region.type === "split") return { ...region, regions: region.regions.map(visit) }
    return region
  }
  return regions.map(visit)
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
    const migratedBriefs = instructionBriefs(regions)
    regions = regions.map(normalizeRegion).filter(Boolean)
    regions = attachBriefsToIllustration(regions, migratedBriefs)
    if (regions.length === 0) regions = FALLBACK_REGIONS.map((r) => ({ ...r }))

    const pieces = Array.isArray(p.pieces) ? p.pieces.filter((x) => typeof x === "string" && x.trim()) : undefined

    return { id, title, purpose, pieces, regions }
  })

  return { pages }
}

// selectedDesign now lives in measure.js (imported above) so the measure
// pass and the renderers pick THE SAME design for a page.

function renderNote(box, text) {
  const note = text || ""
  const accent = 4
  let s = R(box.x, box.y, box.width, box.height, palette.white.hex, palette.ink.hex, "0.8")
  s += R(box.x, box.y, accent, box.height, palette.yellow.hex, palette.yellow.hex, "0")
  const textX = box.x + accent + INSET
  const lines = wrapLines(note, Math.max(1, box.width - (accent + INSET * 2)), 10)
  lines.slice(0, Math.max(1, Math.floor((box.height - GRID.baseline) / GRID.baseline))).forEach((line, i) => {
    s += TX(textX, box.y + GRID.baseline + i * GRID.baseline, line, 10, false, "start")
  })
  return s
}

function renderDocumentIndex(box, entries) {
  const rows = documentIndexRows(entries, box.width)
  let s = ""
  s += R(box.x, box.y, box.width, box.height, palette.white.hex, palette.ink.hex, "0.8")
  s += R(box.x, box.y, box.width, GRID.baseline, palette.blue.hex, palette.ink.hex, "0.8")
  s += TX(box.x + INSET, box.y + GRID.baseline / 2, "INDICE DE PRODUCCION", PRINT.bodyFont, true, "start", palette.white.hex)
  let rowTop = box.y + GRID.baseline * 2
  rows.forEach(({ entry, lines, height }) => {
    const purpose = String(entry.purpose || "")
    const role = purpose.startsWith("design:") ? "APLICACION" : purpose === "lining" ? "INTERIOR" : purpose === "label" ? "ROTULADO" : "CONSTRUCCION"
    const centerY = rowTop + height / 2
    s += TX(box.x + INSET, centerY, String(entry.pageNumber).padStart(2, "0"), PRINT.minFont, true, "start", palette.red.hex, undefined)
    lines.forEach((line, index) => {
      s += TX(box.x + 52, rowTop + GRID.baseline * (index + 0.5), line, PRINT.minFont, true, "start")
    })
    s += TX(box.x + box.width - INSET, centerY, role, PRINT.minFont, true, "end", palette.ink.hex)
    rowTop += height
  })
  return s
}

function renderDocumentFooter(box, hdr, meta) {
  const current = Number(meta && meta.pageNumber) || 1
  const total = Number(meta && meta.totalPages) || 1
  const yearMatch = String((hdr && (hdr.season || hdr.outd)) || "").match(/20\d{2}/)
  const version = (meta && meta.documentVersion) || (hdr && hdr.documentVersion) || "V1/" + (yearMatch ? yearMatch[0] : "2026")
  const approvalValue = (meta && meta.approvalStatus) || (hdr && hdr.approvalStatus) || "not-approved"
  const approved = approvalValue === true || approvalValue === "approved" || approvalValue === "production-approved"
  const approval = approved ? "APROBADA PARA PRODUCCION" : "NO APROBADA PARA PRODUCCION"
  const brand = String((hdr && hdr.brand) || "MARCA")
  const left = fitText(version + " · " + approval, box.width * 0.42, box.height - 4, { maxSize: PRINT.minFont, minSize: PRINT.minFont, lineHeightRatio: 1 })
  let s = "<g id='PAGE_CHROME__FOOTER'>"
  s += R(box.x, box.y, box.width, box.height, palette.white.hex, palette.ink.hex, "0.8")
  s += TX(box.x + INSET, box.y + box.height / 2, left.lines[0] || version + " · " + approval, PRINT.minFont, true, "start", approved ? palette.ink.hex : palette.red.hex)
  s += TX(box.x + box.width * 0.64, box.y + box.height / 2, "TODOS LOS DERECHOS · " + brand, PRINT.minFont, false, "middle", palette.ink.hex)
  s += TX(box.x + box.width - INSET, box.y + box.height / 2, "P. " + String(current).padStart(2, "0") + " / " + String(total).padStart(2, "0"), PRINT.minFont, true, "end", palette.ink.hex, undefined)
  s += "</g>"
  return s
}

function semanticGroup(type, markup) {
  const ids = {
    header: "PAGE_CHROME__HEADER",
    titleBar: "PAGE_CHROME__TITLE",
    illustration: "ARTWORK",
    partsList: "TECH_DATA__BOM",
    colorSpecs: "TECH_DATA__COLORS",
    embSpecs: "TECH_DATA__EMBROIDERY",
    references: "REFERENCES",
    documentIndex: "DOCUMENT_INDEX",
    note: "TECH_DATA__NOTES",
  }
  return "<g id='" + (ids[type] || "REGION__" + String(type).toUpperCase()) + "'>" + markup + "</g>"
}

function leafForRegion(region, page, ctx) {
  const t = T[(ctx && ctx.lang) || "ES"] || T.ES
  const design = selectedDesign(page, ctx)
  const garment = ctx && ctx.garment ? ctx.garment : null
  const partLabels = garment && garment.partLabels ? garment.partLabels[(ctx && ctx.lang) || "ES"] || garment.partLabels.ES || {} : {}
  const txData = ctx && ctx.txData ? ctx.txData : null
  const hdr = ctx && ctx.hdr ? ctx.hdr : {}

  // Structural chrome takes a fixed height. Content blocks: interpretPagePlan
  // pre-computes measure-then-solve sizing in region._sizing (bounded blocks
  // at natural height, absorbers growing by weight); a region without it
  // (split inner columns, direct calls) falls back to weight-driven grow.
  var fixed = FIXED_BASIS[region.type]
  var sizing = region._sizing || (fixed ? { basis: fixed, grow: 0, shrink: 0 } : { grow: region.grow })
  return leaf({
    ...sizing,
    min: sizing.min !== undefined ? sizing.min : region.type === "spacer" ? 0 : 20,
    // Tags this leaf so buildPlannedPages can find it post-solve and read its
    // ALLOTTED height - the box height depends only on the plan's weights,
    // never on how many parts are shown, so it's a stable measuring stick for
    // "does this page's part count actually fit here" (see partsCapacity).
    _isPartsList: region.type === "partsList",
    _regionType: region.type,
    render: (box) => {
      if (region.type === "header") {
        return semanticGroup(region.type, "<g transform='translate(" + box.x + " " + box.y + ")'>" + svgHeader(hdr, ctx && ctx.logo, box.width, box.height) + "</g>")
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
        return semanticGroup(region.type, s)
      }
      if (region.type === "illustration") {
        // Structured per-slot briefs: the AI's `briefs[]` normalized against
        // the page's design data. On non-design pages the design fallback is
        // suppressed so derived defaults describe the GARMENT, not whichever
        // design happens to be first.
        const isDesignPage = typeof page.purpose === "string" && page.purpose.startsWith("design:")
        const briefsCtx = isDesignPage ? ctx : { ...ctx, designs: [] }
        const artworkMarkup = renderIllustrationZone(box, {
          slots: region.slots,
          refs: region.refs,
          briefs: normalizeSlotBriefs(region, page, briefsCtx),
          note: region.note || (design && design.illustrationBrief) || "",
          slotOffset: region._slotOffset,
          clipPrefix: page.id,
        })
        return region._mosaicSlot
          ? "<g id='ARTWORK__V" + (Number(region._slotOffset) + 1) + "'>" + artworkMarkup + "</g>"
          : semanticGroup(region.type, artworkMarkup)
      }
      if (region.type === "partsList") {
        // ctx.parts already reflects this page's pieces (see interpretPagePlan)
        // and, for a paginated continuation page, the exact remaining slice.
        return semanticGroup(region.type, renderPartsList(box, {
          parts: (ctx && ctx.parts) || [],
          partLabels,
          txParts: txData && txData.parts,
          labels: { spec: t.sp, detail: t.dt },
          compact: true,
          fill: !!region._fillRows,
          startIndex: (ctx && ctx.partsStartIndex) || 0,
        }))
      }
      if (region.type === "colorSpecs") return semanticGroup(region.type, renderColorSpecs(box, { colors: design && design.colors }))
      if (region.type === "embSpecs") return semanticGroup(region.type, renderEmbSpecs(box, { emb: design && design.emb, title: t.embTitle }))
      if (region.type === "references") return semanticGroup(region.type, renderReferenceAsset(box, { design }))
      if (region.type === "documentIndex") return semanticGroup(region.type, renderDocumentIndex(box, ctx && ctx.documentIndex))
      if (region.type === "note") return semanticGroup(region.type, renderNote(box, region.note || page.purpose || ""))
      if (region.type === "disclaimer") return renderDocumentFooter(box, hdr, ctx && ctx.pageMeta)
      return ""
    },
  })
}

// Maps one normalized region to a layout node. Constraint-composed rows carry
// explicit widths derived from legibility bands and priorities, plus the
// natural cross-axis height of every bounded table. That lets a short table
// end where its content ends instead of drawing an empty full-height column.
// Authored splits without constraint metadata retain their normalized weights.
function buildRegionNode(region, page, ctx, allottedHeight) {
  if (region.type === "split") {
    const inner = Array.isArray(region.regions) ? region.regions : []
    // The split container itself carries the page-level measure-then-solve
    // sizing (absorber grow / bounded natural basis) computed by
    // interpretPagePlan; inner columns keep weight-driven WIDTH shares.
    const containerSizing = region._sizing || { grow: region.grow }

    if (region._composition === "constraint-row") {
      const children = inner.map((r) => ({
        ...leafForRegion({ ...r, grow: 0 }, page, ctx),
        basis: r._columnWidth,
        grow: 0,
        shrink: 0,
        crossBasis: r.type === "illustration" ? allottedHeight : Math.min(allottedHeight, r._naturalHeight || allottedHeight),
      }))
      return row({ ...containerSizing, gap: SPLIT_GAP, align: "start" }, children)
    }

    const grows = weightsToGrow(inner)
    const children = inner.map((r, i) => leafForRegion({ ...r, grow: grows[i] }, page, ctx))
    return row({ ...containerSizing, gap: SPLIT_GAP }, children)
  }
  return leafForRegion(region, page, ctx)
}

function buildCompositionNode(ast, page, ctx, isRoot = false) {
  if (!ast) return leaf({ grow: 1, render: () => "" })
  if (ast.kind === "region") {
    return {
      ...leafForRegion({ ...ast.region, grow: 0 }, page, ctx),
      basis: isRoot ? undefined : ast.height,
      grow: isRoot ? 1 : 0,
      shrink: 0,
    }
  }
  const direction = ast.axis === "column" ? "column" : "row"
  const children = (ast.children || []).map((child) => {
    const node = buildCompositionNode(child, page, ctx)
    return {
      ...node,
      basis: direction === "row" ? child.width : child.height,
      crossBasis: direction === "row" ? child.height : child.width,
      grow: 0,
      shrink: 0,
    }
  })
  const props = {
    grow: isRoot ? 1 : 0,
    basis: isRoot ? undefined : direction === "row" ? ast.width : ast.height,
    gap: ast.gap || (direction === "column" ? GRID.verticalGap : GRID.gutter),
    align: ast.align || "start",
  }
  return direction === "row" ? row(props, children) : col(props, children)
}

export function interpretPagePlan(page, ctx) {
  const safeCtx = ctx || {}
  const normalized = optimizePageComposition(normalizePlan({ pages: [page] }).pages[0], safeCtx, { width: CONTENT_W, height: workingHeight(safeCtx) })
  const grows = weightsToGrow(normalized.regions)
  // Piece-aware narrowing happens ONCE here, so both a direct interpretPagePlan
  // call (tests) and the full buildPlannedPages path share one source of truth
  // for "which parts does this page actually show."
  const pageCtx = { ...safeCtx, parts: effectivePartsForPage(safeCtx.parts, normalized) }

  if (normalized._layoutAst) {
    const byType = (type) => normalized.regions.find((region) => region.type === type)
    const nodes = []
    const header = byType("header")
    const title = byType("titleBar")
    const footer = byType("disclaimer")
    if (header) nodes.push(leafForRegion({ ...header, _sizing: { basis: headerHeight(pageCtx.hdr, CONTENT_W), grow: 0, shrink: 0 } }, normalized, pageCtx))
    if (title) nodes.push(leafForRegion({ ...title, _sizing: { basis: FIXED_BASIS.titleBar, grow: 0, shrink: 0 } }, normalized, pageCtx))
    nodes.push(buildCompositionNode(normalized._layoutAst, normalized, pageCtx, true))
    if (footer) nodes.push(leafForRegion({ ...footer, _sizing: { basis: FIXED_BASIS.disclaimer, grow: 0, shrink: 0 } }, normalized, pageCtx))
    return col({ padding: PAGE_PAD, gap: PAGE_GAP }, nodes)
  }
  const heights = estimateRegionHeights(normalized.regions, grows, normalized, pageCtx)

  // ── Measure then solve ────────────────────────────────────────────────────
  // Bounded data blocks take exactly their measured natural height (grow:0,
  // compressible toward their legible min if the page genuinely overflows);
  // absorbers (illustration/spacer, or a split containing one) split ALL the
  // slack by their plan weights. The AI's weights now express PRIORITY among
  // absorbers, not arbitrary heights for data blocks - a two-row table can no
  // longer be stretched into a half-page band of white.
  const measures = normalized.regions.map((r) => measureNode(r, normalized, pageCtx, CONTENT_W))
  const hasAbsorber = measures.some((m, index) => m.canAbsorb || normalized.regions[index]._fillRows)
  const regions = normalized.regions.map((region, i) => {
    const m = measures[i]
    let _sizing
    if (FIXED_BASIS[region.type]) _sizing = { basis: FIXED_BASIS[region.type], grow: 0, shrink: 0 }
    else if (m.canAbsorb || region._fillRows) _sizing = { grow: Math.max(1, grows[i]), min: m.min }
    else _sizing = { basis: m.natural || 0, grow: 0, shrink: 0, min: m.min }
    return { ...region, grow: grows[i], _sizing }
  })

  const nodes = regions.map((region, i) => buildRegionNode(region, normalized, pageCtx, heights[i]))
  // A page with no absorber at all (pure data pages) parks the slack in ONE
  // deliberate place - an invisible spacer before the last chrome strip - so
  // the disclaimer stays pinned to the page bottom and the content reads
  // top-anchored, instead of the leftover appearing as a random gap.
  if (!hasAbsorber) {
    const lastFixed = regions.length > 0 && FIXED_BASIS[regions[regions.length - 1].type] ? 1 : 0
    nodes.splice(nodes.length - lastFixed, 0, leaf({ grow: 1, min: 0, render: () => "" }))
  }
  return col({ padding: PAGE_PAD, gap: PAGE_GAP }, nodes)
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

function findRegionLeaf(node, type) {
  if (!node) return null
  if (node._regionType === type) return node
  if (node.children) {
    for (const child of node.children) {
      const found = findRegionLeaf(child, type)
      if (found) return found
    }
  }
  return null
}

function availableTableHeight(leafNode) {
  if (!leafNode) return 0
  // A natural-height table is deliberately non-shrinkable. When its content
  // is taller than the page, the solved leaf may extend past the footer; use
  // the physical page boundary for pagination capacity, never that overflowed
  // natural box.
  const bottomChrome = PAGE_PAD + FIXED_BASIS.disclaimer + PAGE_GAP
  return Math.max(0, Math.min(leafNode.height, PAGE_H - bottomChrome - leafNode.y))
}

function measuredPartsCapacity(parts, pageCtx, width, height) {
  const garment = pageCtx && pageCtx.garment
  const lang = (pageCtx && pageCtx.lang) || "ES"
  const partLabels = garment && garment.partLabels ? garment.partLabels[lang] || garment.partLabels.ES || {} : {}
  const txParts = pageCtx && pageCtx.txData && pageCtx.txData.parts
  return partsCapacityForHeight({ parts, partLabels, txParts, width: width || GRID.span(3) }, height)
}

function partsContinuationPage(page, continuation) {
  return {
    id: page.id + "-cont-" + continuation,
    title: (page.title || "") + " (cont.)",
    purpose: page.purpose,
    regions: [
      { type: "header", weight: 8 },
      { type: "titleBar", weight: 5 },
      { type: "partsList", weight: 79, _fillRows: true },
      { type: "disclaimer", weight: 8 },
    ],
  }
}

function colorCapacity(height) {
  return Math.max(0, Math.floor((height - 32) / 32))
}

function embroideryStopCapacity(height) {
  // Fourteen base fields + sequence heading/rule consume sixteen rows before
  // the individual stops. Fourteen units is the renderer's legible floor.
  return Math.max(0, Math.floor((height - 32) / 16) - 16)
}

function withDesignSlice(page, pageCtx, colors, stopSeq) {
  const designs = pageCtx && Array.isArray(pageCtx.designs) ? pageCtx.designs : []
  const selected = selectedDesign(page, pageCtx)
  const index = designs.indexOf(selected)
  if (index < 0) return pageCtx
  const design = { ...selected }
  if (colors !== undefined) design.colors = colors
  if (stopSeq !== undefined) design.emb = { ...(design.emb || {}), stopSeq, stops: stopSeq.length }
  return { ...pageCtx, designs: designs.map((item, i) => i === index ? design : item) }
}

function pageForDataSlice(page, keepColors, keepEmb, continuation) {
  function filter(regions) {
    return (regions || []).flatMap((region) => {
      if (region.type === "colorSpecs" && !keepColors) return []
      if (region.type === "embSpecs" && !keepEmb) return []
      if (region.type !== "split") return [region]
      const inner = filter(region.regions)
      return inner.length > 0 ? [{ ...region, regions: inner }] : []
    })
  }
  if (!continuation) return { ...page, regions: filter(page.regions) }
  return {
    ...page,
    id: page.id + "-data-cont-" + continuation,
    title: (page.title || "") + " (cont.)",
    regions: filter(page.regions),
  }
}

function composingStopCapacity(page, pageCtx, colors, stopSeq, continuation) {
  if (!Array.isArray(stopSeq) || stopSeq.length === 0) return 0
  const slicedPage = pageForDataSlice(page, Array.isArray(colors) && colors.length > 0, true, continuation)
  for (let count = stopSeq.length; count > 0; count--) {
    const candidateCtx = withDesignSlice(slicedPage, pageCtx, colors, stopSeq.slice(0, count))
    const optimized = optimizePageComposition(normalizePlan({ pages: [slicedPage] }).pages[0], candidateCtx, { width: CONTENT_W, height: workingHeight(candidateCtx) })
    if (!optimized._compositionDecision || optimized._compositionDecision.valid) return count
  }
  return 1
}

export function buildPlannedPages(plan, ctx, opts) {
  const mono = !!(opts && opts.mono)
  const documentMode = (opts && opts.documentMode) || (ctx && ctx.documentMode) || "fixture"
  const includeIndex = !!(opts && opts.includeIndex)
  const normalized = normalizePlan(plan)
  const W = PAGE_W
  const H = PAGE_H
  const allParts = (ctx && ctx.parts) || []

  const baseCtx = { ...(ctx || {}), documentMode }
  function resolvedTreeFor(page, pageCtx) {
    return solveLayout(interpretPagePlan(page, { ...baseCtx, ...(pageCtx || {}) }), { x: 0, y: 0, width: W, height: H })
  }
  function svgFor(page, pageCtx, meta) {
    const resolved = resolvedTreeFor(page, { ...pageCtx, pageMeta: meta })
    let svg = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + PAGE.physicalWidth + "' height='" + PAGE.physicalHeight + "' data-document-status='" + documentMode + "'>"
    svg += "<metadata>{\"documentMode\":\"" + documentMode + "\",\"pageNumber\":" + meta.pageNumber + ",\"totalPages\":" + meta.totalPages + "}</metadata>"
    svg += "<rect width='" + W + "' height='" + H + "' fill='" + palette.white.hex + "' stroke='" + palette.ink.hex + "' stroke-width='1.5'/>"
    svg += renderLayoutToSVG(resolved)
    svg += "</svg>"
    // Grayscale is a pure post-process on the finished page (see toGrayscale) -
    // no renderer needs a parallel "mono" path.
    return mono ? toGrayscale(svg) : svg
  }

  const descriptors = []
  function addDescriptor(page, pageCtx, sourceIndex) {
    descriptors.push({ page, pageCtx: { ...baseCtx, ...(pageCtx || {}) }, sourceIndex, name: pageName(page, sourceIndex) })
  }

  normalized.pages.forEach((page, i) => {
    const firstPass = resolvedTreeFor(page, baseCtx)
    const partsLeaf = findPartsListLeaf(firstPass)
    const effective = effectivePartsForPage(allParts, page)

    // Color and embroidery tables use elastic rows down to explicit legible
    // floors. If even those floors cannot contain every row, continue the
    // technical data across pages while retaining the page's illustration and
    // chrome. No row is clipped and no font is reduced below its contract.
    const design = selectedDesign(page, ctx)
    const colors = design && Array.isArray(design.colors) ? design.colors.filter((color) => color && color.hex) : []
    const stopSeq = design && design.emb && Array.isArray(design.emb.stopSeq) ? design.emb.stopSeq : []
    const colorLeaf = findRegionLeaf(firstPass, "colorSpecs")
    const embLeaf = findRegionLeaf(firstPass, "embSpecs")
    const colorCap = colorLeaf ? Math.max(1, colorCapacity(availableTableHeight(colorLeaf))) : colors.length
    const tableEmbCap = embLeaf ? Math.max(1, embroideryStopCapacity(availableTableHeight(embLeaf))) : stopSeq.length
    const firstEmbCap = embLeaf && stopSeq.length > 0
      ? Math.min(tableEmbCap, composingStopCapacity(page, baseCtx, colors, stopSeq, 0))
      : tableEmbCap
    const continuationEmbCap = embLeaf && stopSeq.length > 0
      ? composingStopCapacity(page, baseCtx, [], stopSeq, 1)
      : tableEmbCap
    const colorOverflow = !!colorLeaf && colors.length > colorCap
    const embOverflow = !!embLeaf && stopSeq.length > firstEmbCap

    if (colorOverflow || embOverflow) {
      let colorOffset = 0
      let stopOffset = 0
      let dataPageIndex = 0
      while (colorOffset < colors.length || stopOffset < stopSeq.length) {
        const stopCap = dataPageIndex === 0 ? firstEmbCap : continuationEmbCap
        const colorChunk = colorOverflow ? colors.slice(colorOffset, colorOffset + colorCap) : dataPageIndex === 0 ? colors : []
        const stopChunk = embOverflow ? stopSeq.slice(stopOffset, stopOffset + stopCap) : dataPageIndex === 0 ? stopSeq : []
        const slicedPage = pageForDataSlice(page, colorChunk.length > 0, !!embLeaf && (stopChunk.length > 0 || (!embOverflow && dataPageIndex === 0)), dataPageIndex)
        const slicedCtx = withDesignSlice(slicedPage, baseCtx, colorChunk, stopChunk)
        addDescriptor(slicedPage, slicedCtx, i)
        colorOffset += colorOverflow ? colorChunk.length : colors.length
        stopOffset += embOverflow ? stopChunk.length : stopSeq.length
        dataPageIndex++
      }
      return
    }

    const firstPartsCapacity = partsLeaf
      ? measuredPartsCapacity(effective, baseCtx, partsLeaf.width, availableTableHeight(partsLeaf))
      : effective.length
    if (!partsLeaf || effective.length <= firstPartsCapacity) {
      addDescriptor(page, baseCtx, i)
      return
    }

    // Overflow: the plan gave this page's parts list less room than its real
    // piece count needs. A real designer wouldn't shrink the text to the
    // point of illegibility or silently lose rows - they'd split the table
    // across a "(cont.)" page, numbering continuing so it still reads as one
    // BOM. Every other block already shrinks-to-fit (fitText, dynamic specs
    // row height); the parts list is the one place row height is fixed for
    // readability, so it's the one that paginates instead.
    const cap = Math.max(1, firstPartsCapacity)
    const continuationProbePage = partsContinuationPage(page, 1)
    const continuationProbe = resolvedTreeFor(continuationProbePage, { ...baseCtx, parts: effective, partsStartIndex: 0 })
    const continuationLeaf = findPartsListLeaf(continuationProbe)
    const continuationCapacity = Math.max(1, measuredPartsCapacity(
      effective,
      baseCtx,
      continuationLeaf && continuationLeaf.width,
      continuationLeaf ? availableTableHeight(continuationLeaf) : H
    ))

    // Capacity is a ceiling, not a target. Choose the smallest page count that
    // can hold every row, then distribute rows as evenly as those ceilings
    // allow. A 40-row BOM therefore reads 20/20 instead of a cramped 29/11.
    let pageCount = 2
    let firstChunkSize = 1
    while (true) {
      firstChunkSize = Math.min(cap, Math.ceil(effective.length / pageCount))
      const remaining = effective.length - firstChunkSize
      if (remaining <= (pageCount - 1) * continuationCapacity) break
      pageCount++
    }

    const cappedCtx = { ...baseCtx, parts: effective.slice(0, firstChunkSize), partsStartIndex: 0 }
    addDescriptor({ ...page, pieces: undefined }, cappedCtx, i)

    let rest = effective.slice(firstChunkSize)
    let startIndex = firstChunkSize
    let contN = 1
    while (rest.length > 0) {
      const contPage = partsContinuationPage(page, contN)
      const remainingPages = pageCount - contN
      const chunkSize = Math.min(continuationCapacity, Math.ceil(rest.length / remainingPages))
      const chunk = rest.slice(0, chunkSize)
      addDescriptor(contPage, { ...baseCtx, parts: chunk, partsStartIndex: startIndex }, i)
      rest = rest.slice(chunkSize)
      startIndex += chunkSize
      contN++
    }
  })

  if (includeIndex && !descriptors.some((descriptor) => descriptor.page.purpose === "cover")) {
    const coverPage = {
      id: "cover-index",
      title: (baseCtx.hdr && baseCtx.hdr.pname) || "Illustration Handoff",
      purpose: "cover",
      regions: [
        { type: "header", weight: 1 },
        { type: "titleBar", weight: 1 },
        { type: "illustration", weight: 1, slots: 1, refs: ["Vista general"] },
        { type: "disclaimer", weight: 1 },
      ],
    }
    descriptors.unshift({ page: coverPage, pageCtx: baseCtx, sourceIndex: -1, name: "cover_index" })
  }

  const totalPages = descriptors.length
  const indexEntries = descriptors.map((descriptor, index) => ({
    pageNumber: index + 1,
    name: descriptor.name,
    title: descriptor.page.title,
    purpose: descriptor.page.purpose,
    status: descriptor.page.regions.some((region) => region.type === "illustration" || (region.type === "split" && (region.regions || []).some((inner) => inner.type === "illustration"))) ? "illustration-pending" : "ready",
  }))

  if (includeIndex && descriptors.length > 0) {
    const coverIndex = descriptors.findIndex((descriptor) => descriptor.page.purpose === "cover")
    const descriptor = descriptors[coverIndex]
    const regions = descriptor.page.regions.slice()
    const footerIndex = regions.findIndex((region) => region.type === "disclaimer")
    regions.splice(footerIndex >= 0 ? footerIndex : regions.length, 0, { type: "documentIndex", weight: 1 })
    descriptor.page = { ...descriptor.page, regions }
    descriptor.pageCtx = { ...descriptor.pageCtx, documentIndex: indexEntries.filter((entry) => entry.purpose !== "cover") }
  }

  return descriptors.map((descriptor, index) => {
    const meta = {
      id: descriptor.page.id,
      title: descriptor.page.title,
      purpose: descriptor.page.purpose,
      pageNumber: index + 1,
      totalPages,
      status: indexEntries[index].status,
      documentMode,
      documentVersion: baseCtx.documentVersion,
      approvalStatus: baseCtx.approvalStatus,
    }
    const composed = optimizePageComposition(normalizePlan({ pages: [descriptor.page] }).pages[0], descriptor.pageCtx, { width: CONTENT_W, height: workingHeight(descriptor.pageCtx) })
    return {
      ...meta,
      name: descriptor.name,
      compositionDecision: composed._compositionDecision || null,
      svg: svgFor(descriptor.page, descriptor.pageCtx, meta),
    }
  })
}
