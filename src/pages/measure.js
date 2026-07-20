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
import { effectiveParts, partsTableMetrics } from "./tableMetrics.js"

// Which design a page is about: an explicit "design:<name>" purpose token
// wins, then the page's first `covers` entry, then the first design. Moved
// here from interpretPlan.js (which now imports it) so measure and render
// select THE SAME design - a mismatch would make the measure pass size a
// block for one design's data while the renderer draws another's.
export function selectedDesign(page, ctx) {
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
    const table = partsTableMetrics({ parts, partLabels, txParts, width: width || 300 })
    return {
      natural: table.height,
      min: table.height,
      canAbsorb: false,
    }
  }

  if (type === "colorSpecs") {
    const design = selectedDesign(page, ctx)
    const n = design && Array.isArray(design.colors) ? design.colors.filter((c) => c && c.hex).length : 0
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
    const totalRows = 14 + (stopSeq.length > 0 ? 2 + stopSeq.length : 0)
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
