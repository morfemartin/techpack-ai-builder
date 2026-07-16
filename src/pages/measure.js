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
// buildPages.js actually draw. The section-head constants mirror the
// renderers exactly: 32 = renderColorSpecs' rule gap 6 + bar 20 + gap 6;
// 38 = renderEmbSpecs' rule gap 6 + bar 20 + gaps 12. Row heights come from
// the shared metrics ROW scale. If a renderer's geometry changes, this
// module changes with it (measure.test.js locks the agreement).
//
// First draft delegated to the local DeepSeek orchestrator against the
// measure.test.js contract; reviewed and integrated here.
// ─────────────────────────────────────────────────────────────────────────────

import { ROW } from "../design/metrics.js"
import { wrapLines } from "../core/svgPrimitives.js"

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

export function measureRegion(region, page, ctx, width) {
  const fallback = { natural: 0, min: 0, canAbsorb: false }
  if (!region || typeof region.type !== "string") return fallback
  const type = region.type

  // Fixed chrome strips (same values as interpretPlan's FIXED_BASIS).
  if (type === "header") return { natural: 82, min: 82, canAbsorb: false }
  if (type === "titleBar") return { natural: 30, min: 30, canAbsorb: false }
  if (type === "disclaimer") return { natural: 20, min: 20, canAbsorb: false }

  // Absorbers: fill whatever the page has left over.
  if (type === "illustration") return { natural: null, min: 120, canAbsorb: true }
  if (type === "spacer") return { natural: 0, min: 0, canAbsorb: true }

  if (type === "partsList") {
    const parts = ctx && Array.isArray(ctx.parts) ? ctx.parts : []
    const n = parts.filter((p) => p && p.on !== false).length
    return {
      natural: ROW.tableHeader + n * ROW.table,
      min: ROW.tableHeader + n * 24, // compact renderer's min row
      canAbsorb: false,
    }
  }

  if (type === "colorSpecs") {
    const design = selectedDesign(page, ctx)
    const n = design && Array.isArray(design.colors) ? design.colors.filter((c) => c && c.hex).length : 0
    if (n === 0) return { natural: 0, min: 0, canAbsorb: false }
    return {
      natural: 32 + n * ROW.color,
      min: 32 + n * 16, // colorRowHeight's legible floor
      canAbsorb: false,
    }
  }

  if (type === "embSpecs") {
    const design = selectedDesign(page, ctx)
    const emb = design && design.emb ? design.emb : null
    if (!emb) return { natural: 0, min: 0, canAbsorb: false }
    const stopSeq = Array.isArray(emb.stopSeq) ? emb.stopSeq : []
    const totalRows = 14 + (stopSeq.length > 0 ? 1 + stopSeq.length : 0)
    return {
      natural: 38 + totalRows * ROW.emb,
      min: 38 + totalRows * 11, // renderEmbSpecs' row floor
      canAbsorb: false,
    }
  }

  if (type === "note") {
    const text = typeof region.note === "string" ? region.note : ""
    if (text.trim() === "") return { natural: 0, min: 0, canAbsorb: false }
    const lines = wrapLines(text, Math.max(1, (width || 100) - 20), 10)
    const natural = 16 + lines.length * 14
    return { natural, min: natural, canAbsorb: false } // text never compresses
  }

  return fallback
}
