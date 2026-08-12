// ─────────────────────────────────────────────────────────────────────────────
// MEASURE REGISTRY — the content-side half of "measure then solve".
//
// measureRegion(region, page, ctx, width) answers, for every plan region
// type, "how tall does this block WANT to be for the data it actually
// carries?" as a pure function - no solving, no rendering. The interpreter
// uses it to give bounded data blocks their natural height (grow:0) and route
// every leftover pixel to the absorbers (illustration/spacer), which is what
// keeps a page free of dead white bands without ever compressing data below
// legibility.
//
// HARD RULE: these numbers must never disagree with what the renderers in
// buildPages.js actually draw. Technical module heads occupy 32 units and
// every following row is an integer multiple of the 16-unit baseline. If a
// renderer's geometry changes, this module changes with it (measure.test.js
// locks the agreement).
//
// First draft delegated to the local DeepSeek orchestrator against the
// measure.test.js contract; reviewed and integrated here.
// ─────────────────────────────────────────────────────────────────────────────

import { CHROME, GRID, PRINT, ROW, snapBaseline } from "../design/metrics.js"
import { headerHeight, wrapLines } from "../core/svgPrimitives.js"
import { hasEmbSpecs } from "../core/helpers.js"
import { hasColorData } from "../core/colorSpecs.js"
import { effectiveParts, partsTableMetrics, translatedPartsById, sizeChartTableLayout } from "./tableMetrics.js"
import { hasSizeChartData } from "../core/sizeChart.js"

// Which design a page is about: an explicit "design:<name>" purpose token
// wins, then the page's first `covers` entry. Moved here from
// interpretPlan.js (which now imports it) so measure and render select THE
// SAME design - a mismatch would make the measure pass size a block for one
// design's data while the renderer draws another's.
//
// A page with NEITHER is about no design at all, and returns null. It used to
// fall back to designs[0], which meant every construction page silently
// "had" a design: whenever the AI planner put a design-ish block on a BOM or
// structure page, that page cheerfully rendered the first design's artwork
// and specs. Forbidding those blocks per purpose (pageContracts) fixed the
// deterministic path, but the planner can still propose an illustration
// carrying design briefs - so the ownership question has to be answered
// here, at the source, not block by block downstream.
export function selectedDesign(page, ctx) {
  const designs = ctx && Array.isArray(ctx.designs) ? ctx.designs : []
  if (designs.length === 0) return null
  const purpose = page && typeof page.purpose === "string" ? page.purpose : ""
  const token = purpose.startsWith("design:") ? purpose.slice("design:".length).trim() : ""
  const cover = page && Array.isArray(page.covers) && page.covers.length > 0 ? String(page.covers[0]).trim() : ""
  const key = token || cover
  if (!key) return null

  const numeric = Number(key)
  if (Number.isInteger(numeric)) {
    if (designs[numeric]) return designs[numeric]
    if (designs[numeric - 1]) return designs[numeric - 1]
  }

  const needle = key.toLowerCase()
  // Named but unmatched still falls back to the first design: the page IS
  // about a design, we just could not resolve which - better to draw one
  // than to blank a page that exists to show it.
  return designs.find((d) => d && typeof d.name === "string" && d.name.toLowerCase() === needle) || designs[0]
}

export function pageColors(page, ctx) {
  if (page && page.purpose === "data:colorways") {
    if (ctx && ctx.txData && Array.isArray(ctx.txData.fabricColors)) {
      const original = Array.isArray(ctx.fabricColors) ? ctx.fabricColors : []
      return ctx.txData.fabricColors.map((color, index) => ({ ...original[index], ...color, name: color.name }))
    }
    return ctx && Array.isArray(ctx.fabricColors) ? ctx.fabricColors : []
  }
  const design = selectedDesign(page, ctx)
  const designIndex = design && ctx && Array.isArray(ctx.designs) ? ctx.designs.indexOf(design) : -1
  if (designIndex >= 0 && ctx && ctx.txData && Array.isArray(ctx.txData.designs)) {
    const translated = ctx.txData.designs[designIndex]
    if (translated && Array.isArray(translated.colors)) return translated.colors.map((color, index) => ({ ...design.colors[index], ...color, name: color.name }))
  }
  return design && Array.isArray(design.colors) ? design.colors : []
}

export function documentIndexRows(entries, width) {
  const safeWidth = Math.max(320, Number(width || 0))
  const titleWidth = safeWidth * 0.24
  const descriptionWidth = safeWidth * 0.48
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const title = entry && (entry.title || entry.purpose || entry.name) || "Pagina"
    const lines = wrapLines(title, titleWidth, PRINT.minFont)
    const descriptionLines = wrapLines(entry && entry.description || "Contenido tecnico de la seccion", descriptionWidth, PRINT.minFont)
    const lineCount = Math.max(lines.length, descriptionLines.length)
    return { entry, lines, descriptionLines, height: Math.max(GRID.baseline * 2, lineCount * GRID.baseline) }
  })
}

export function paginateDocumentIndexEntries(entries, width, availableHeight) {
  const rows = documentIndexRows(entries, width)
  const rowBudget = Math.max(GRID.baseline * 2, Number(availableHeight || 0) - GRID.baseline * 3)
  const pages = []
  let current = []
  let used = 0

  rows.forEach((row) => {
    if (current.length > 0 && used + row.height > rowBudget) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(row.entry)
    used += row.height
  })
  if (current.length > 0) pages.push(current)
  return pages.length > 0 ? pages : [[]]
}

export function measureRegion(region, page, ctx, width) {
  const fallback = { natural: 0, min: 0, canAbsorb: false }
  if (!region || typeof region.type !== "string") return fallback
  const type = region.type

  // Fixed chrome strips (same values as interpretPlan's FIXED_BASIS).
  if (type === "header") {
    const natural = headerHeight(ctx && ctx.hdr, width || 1188)
    return { natural, min: natural, canAbsorb: false }
  }
  if (type === "titleBar") return { natural: CHROME.titleBar, min: CHROME.titleBar, canAbsorb: false }
  if (type === "disclaimer") return { natural: CHROME.footer, min: CHROME.footer, canAbsorb: false }

  // Absorbers: fill whatever the page has left over.
  if (type === "illustration") return { natural: null, min: 120, canAbsorb: true }
  if (type === "spacer") return { natural: 0, min: 0, canAbsorb: true }

  if (type === "partsList") {
    const parts = effectiveParts(ctx && ctx.parts, page)
    const garment = ctx && ctx.garment
    const partLabels = garment && garment.partLabels
      ? garment.partLabels[(ctx && ctx.lang) || "ES"] || garment.partLabels.ES || {}
      : {}
    const txParts = ctx && ctx.txData && ctx.txData.parts
    // `parts` above is already narrowed to this page, so the flat translated
    // array can no longer be read by row position - resolve by id, using the
    // index interpretPlan built from the full BOM when it is available (see
    // withTranslatedPartIndex) and deriving it here otherwise, since a wrong
    // value here also measures the wrong row height.
    const txPartsById = (ctx && ctx.txPartsById) || translatedPartsById(ctx && ctx.parts, txParts)
    const table = partsTableMetrics({ parts, partLabels, txParts, txPartsById, width: width || 300 })
    return {
      natural: table.height,
      min: table.height,
      canAbsorb: false,
    }
  }

  if (type === "sizeChart") {
    const chart = ctx && ctx.sizeChart
    if (!hasSizeChartData(chart)) return { natural: 0, min: 0, canAbsorb: false }
    const layout = sizeChartTableLayout({ chart, outUnit: ctx && ctx.dimensionUnit, width: width || 300 })
    // + one baseline row per constant caption line, plus the pending-count
    // banner when there is one - both drawn by renderSizeChart AFTER the
    // matrix, so they must count here too or the box comes up short and the
    // banner gets clipped by whatever sits below it on the page.
    const constantsRows = layout.constants.length > 0 ? 1 + layout.constants.length : 0
    const pendingBannerRows = layout.rows.some((row) => row.cells.some((cell) => cell.pending)) ? 1 : 0
    const extra = (constantsRows + pendingBannerRows) * ROW.table
    const total = layout.height + extra
    return { natural: total, min: total, canAbsorb: false }
  }

  if (type === "colorSpecs") {
    const n = pageColors(page, ctx).filter(hasColorData).length
    if (n === 0) return { natural: 0, min: 0, canAbsorb: false }
    return {
      natural: 32 + n * ROW.color,
      min: 32 + n * ROW.color,
      canAbsorb: false,
    }
  }

  if (type === "embSpecs") {
    const design = selectedDesign(page, ctx)
    const emb = design && hasEmbSpecs(design.emb) ? design.emb : null
    if (!emb) return { natural: 0, min: 0, canAbsorb: false }
    const stopSeq = Array.isArray(emb.stopSeq) ? emb.stopSeq : []
    const totalRows = 14 + (stopSeq.length > 0 ? 3 + stopSeq.length : 0)
    return {
      natural: 32 + totalRows * ROW.emb,
      min: 32 + totalRows * ROW.emb,
      canAbsorb: false,
    }
  }

  if (type === "note") {
    const text = typeof region.note === "string" ? region.note : ""
    if (text.trim() === "") return { natural: 0, min: 0, canAbsorb: false }
    const lines = wrapLines(text, Math.max(1, (width || 100) - 20), 10)
    const natural = snapBaseline(GRID.baseline + lines.length * GRID.baseline)
    return { natural, min: natural, canAbsorb: false } // text never compresses
  }

  if (type === "references") {
    const design = selectedDesign(page, ctx)
    return design && design.imageData
      ? { natural: 128, min: 128, canAbsorb: false }
      : { natural: 0, min: 0, canAbsorb: false }
  }

  if (type === "documentIndex") {
    const entries = ctx && Array.isArray(ctx.documentIndex) ? ctx.documentIndex : []
    const natural = GRID.baseline * 3 + documentIndexRows(entries, width).reduce((total, row) => total + row.height, 0)
    return { natural, min: natural, canAbsorb: false }
  }

  return fallback
}
