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
import { col, leaf, solveLayout, renderLayoutToSVG } from "../layout/index.js"
import { palette } from "../design/tokens.js"
import { renderColorSpecs, renderEmbSpecs, renderIllustrationZone, renderPartsList } from "./buildPages.js"

// The only region types the interpreter knows how to render. Anything else the
// model invents is dropped by normalizePlan rather than risking a broken page.
export const VOCAB = ["header", "titleBar", "illustration", "partsList", "colorSpecs", "embSpecs", "note", "spacer", "disclaimer"]

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
    regions = regions
      .filter((r) => r && typeof r === "object" && VOCAB.includes(r.type))
      .map((r) => ({ ...r, weight: safeWeight(r.weight) }))
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

  return leaf({
    grow: region.grow,
    min: region.type === "spacer" ? 0 : 20,
    render: (box) => {
      if (region.type === "header") {
        return "<g transform='translate(" + box.x + " " + box.y + ")'>" + svgHeader(hdr, ctx && ctx.logo, box.width, box.height) + "</g>"
      }
      if (region.type === "titleBar") {
        return R(box.x, box.y, box.width, box.height, palette.blue.hex, palette.ink.hex, "0.8") + TX(box.x + box.width / 2, box.y + box.height / 2, page.title || page.purpose || "", 11, true, "middle", palette.white.hex)
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

export function interpretPagePlan(page, ctx) {
  const normalized = normalizePlan({ pages: [page] }).pages[0]
  const grows = weightsToGrow(normalized.regions)
  const regions = normalized.regions.map((region, i) => ({ ...region, grow: grows[i] }))
  return col({}, regions.map((region) => leafForRegion(region, normalized, ctx || {})))
}

function pageName(page, i) {
  const base = page.id || page.title || "page-" + (i + 1)
  return String(base).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "page_" + (i + 1)
}

export function buildPlannedPages(plan, ctx) {
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
    return { name: pageName(page, i), svg }
  })
}
