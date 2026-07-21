// ─────────────────────────────────────────────────────────────────────────────
// PAGE CONTRACTS — the deterministic guarantee layer of the document planner.
//
// This module encodes how a tech-pack designer thinks, as code: which regions
// MUST be visually present on a page of a given purpose, which are forbidden
// there (nothing repeats that shouldn't - every active part has exactly one
// structural home, never a design page), which data blocks earn their place only when they
// actually carry data, and the canonical chrome order (header → title →
// content → disclaimer).
//
// The AI (DeepSeek, a deliberately small model) PROPOSES an outline and a
// per-page plan; this contract DISPOSES: validatePage/validateOutline report
// violations, repairPage/repairOutline fix them deterministically. Prompts
// guide the model toward good proposals, but every guarantee lives here -
// a bad AI answer degrades to contract defaults, it can never break a page.
//
// Validation half drafted by the local DeepSeek orchestrator against the
// pageContracts.test.js contract; repair half drafted the same way and fixed
// in review (it treated design.emb as an array - it is an object - and
// applied design-conditional mandatory blocks to non-design pages via the
// fallback design). Outline functions written directly.
// ─────────────────────────────────────────────────────────────────────────────

import { selectedDesign } from "./measure.js"
import { hasEmbSpecs } from "../core/helpers.js"
import { balancedChunks, partitionPartsBySystem } from "../core/semanticOutline.js"

export const CONTRACTS = {
  index: {
    mandatory: ["header", "titleBar", "documentIndex", "disclaimer"],
    forbidden: ["illustration", "partsList", "colorSpecs", "embSpecs"],
    priorityRank: { documentIndex: 3 },
    illustrationShare: { min: 0, max: 0 },
    minIllustrationHeight: 0,
    dataSide: "left",
  },
  cover: {
    mandatory: ["header", "titleBar", "illustration", "disclaimer"],
    forbidden: ["partsList", "colorSpecs", "embSpecs"],
    priorityRank: { illustration: 3 },
    illustrationShare: { min: 0.7, max: 1 },
    minIllustrationHeight: 420,
    dataSide: "right",
  },
  overview: {
    mandatory: ["header", "titleBar", "illustration", "partsList", "disclaimer"],
    forbidden: ["colorSpecs", "embSpecs"],
    priorityRank: { illustration: 3, partsList: 2, note: 1 },
    illustrationShare: { min: 0.5, max: 0.72 },
    minIllustrationHeight: 320,
    dataSide: "left",
  },
  structure: {
    mandatory: ["header", "titleBar", "illustration", "partsList", "disclaimer"],
    forbidden: ["colorSpecs", "embSpecs"],
    priorityRank: { illustration: 3, partsList: 2, note: 1 },
    illustrationShare: { min: 0.5, max: 0.72 },
    minIllustrationHeight: 320,
    dataSide: "left",
  },
  lining: {
    mandatory: ["header", "titleBar", "illustration", "partsList", "disclaimer"],
    forbidden: ["colorSpecs", "embSpecs"],
    priorityRank: { illustration: 3, partsList: 2, note: 1 },
    illustrationShare: { min: 0.5, max: 0.72 },
    minIllustrationHeight: 320,
    dataSide: "left",
  },
  label: {
    mandatory: ["header", "titleBar", "illustration", "disclaimer"],
    forbidden: [],
    priorityRank: { illustration: 3, colorSpecs: 1, note: 1 },
    illustrationShare: { min: 0.65, max: 0.85 },
    minIllustrationHeight: 400,
    dataSide: "right",
  },
  design: {
    mandatory: ["header", "titleBar", "illustration", "disclaimer"],
    forbidden: ["partsList"],
    priorityRank: { illustration: 3, embSpecs: 2, colorSpecs: 1, note: 1 },
    illustrationShare: { min: 0.55, max: 0.78 },
    minIllustrationHeight: 360,
    dataSide: "right",
  },
}

const SINGLETONS = new Set(["header", "titleBar", "disclaimer", "partsList", "colorSpecs", "embSpecs", "documentIndex"])

export function purposeFamily(purpose) {
  if (!purpose || typeof purpose !== "string") return "structure"
  const p = purpose.trim()
  if (p.startsWith("design:")) return "design"
  return CONTRACTS[p] && p !== "design" ? p : "structure"
}

export function layoutPolicyFor(page) {
  return CONTRACTS[purposeFamily(page && page.purpose)]
}

export function normalizePriority(value, fallback = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(3, Math.round(numeric)))
}

// The design a "design:<name>" page is strictly about - null for any other
// purpose. Used for the CONDITIONAL mandatory rules (a design page must show
// colorSpecs/embSpecs only when ITS design has that data). Distinct from the
// render-time selectedDesign (measure.js), which falls back to designs[0] -
// that fallback is used for the empty-data checks so the contract judges the
// same data the renderer would actually draw.
export function pageDesign(page, ctx) {
  if (!page || typeof page.purpose !== "string" || !ctx || !Array.isArray(ctx.designs)) return null
  const pur = page.purpose.trim()
  if (!pur.startsWith("design:")) return null
  const token = pur.slice("design:".length).trim().toLowerCase()
  if (!token) return null
  return ctx.designs.find((d) => d && typeof d.name === "string" && d.name.trim().toLowerCase() === token) || null
}

// Leaf regions in document order, recursing into split composites.
export function flattenRegions(regions) {
  if (!Array.isArray(regions)) return []
  const out = []
  for (const r of regions) {
    if (!r || typeof r !== "object") continue
    if (r.type === "split" && Array.isArray(r.regions)) out.push(...flattenRegions(r.regions))
    else out.push(r)
  }
  return out
}

function designHasColors(design) {
  return !!(design && Array.isArray(design.colors) && design.colors.some((c) => c && typeof c.hex === "string" && c.hex.trim()))
}
function designHasEmb(design) {
  return !!(design && hasEmbSpecs(design.emb))
}

// The conditional mandatory extras for a design page: only what ITS design
// actually carries.
function conditionalMandatory(page, ctx, family) {
  if (family !== "design") return []
  const design = pageDesign(page, ctx)
  const extra = []
  if (designHasColors(design)) extra.push("colorSpecs")
  if (designHasEmb(design)) extra.push("embSpecs")
  return extra
}

export function validatePage(page, ctx) {
  const errors = []
  const family = purposeFamily(page && page.purpose)
  const contract = CONTRACTS[family]

  const leaves = flattenRegions(page && page.regions)
  const typeCounts = new Map()
  for (const leaf of leaves) {
    if (!leaf || !leaf.type) continue
    typeCounts.set(leaf.type, (typeCounts.get(leaf.type) || 0) + 1)
  }
  const present = (t) => typeCounts.has(t)

  for (const m of [...contract.mandatory, ...conditionalMandatory(page, ctx, family)]) {
    if (!present(m)) errors.push({ code: "missing-mandatory", type: m })
  }

  for (const f of contract.forbidden) {
    if (present(f)) errors.push({ code: "forbidden-region", type: f })
  }

  // Empty-data: judged against the design the RENDERER would pick for this
  // page (selectedDesign incl. its designs[0] fallback), so contract and
  // pixels agree.
  const renderDesign = selectedDesign(page, ctx)
  if (present("colorSpecs") && !designHasColors(renderDesign)) errors.push({ code: "empty-data-region", type: "colorSpecs" })
  if (present("embSpecs") && !designHasEmb(renderDesign)) errors.push({ code: "empty-data-region", type: "embSpecs" })

  for (const [type, count] of typeCounts) {
    if (SINGLETONS.has(type) && count > 1) errors.push({ code: "duplicate-region", type })
  }

  for (const leaf of leaves) {
    if (leaf.priority !== undefined && normalizePriority(leaf.priority) !== Number(leaf.priority)) {
      errors.push({ code: "invalid-priority", type: leaf.type })
    }
  }

  return errors
}

export function repairPage(page, ctx) {
  const repairs = []
  const family = purposeFamily(page && page.purpose)
  const contract = CONTRACTS[family]
  const renderDesign = selectedDesign(page, ctx)
  const condDesign = pageDesign(page, ctx)

  // Deep copy - regions are plain data at this stage.
  let regions = JSON.parse(JSON.stringify((page && page.regions) || []))

  // One recursive filter pass per rule, splits included; a split emptied by
  // a drop disappears with it.
  const forbiddenSet = new Set(contract.forbidden)
  function filterTree(regs, keep, label) {
    return regs.filter((r) => {
      if (!r || typeof r !== "object") return false
      if (r.type === "split" && Array.isArray(r.regions)) {
        r.regions = filterTree(r.regions, keep, label)
        if (r.regions.length === 0) return false
        return true
      }
      if (!keep(r)) {
        repairs.push(label(r))
        return false
      }
      return true
    })
  }

  regions = filterTree(regions, (r) => !forbiddenSet.has(r.type), (r) => "dropped forbidden " + r.type)

  regions = filterTree(
    regions,
    (r) => !((r.type === "colorSpecs" && !designHasColors(renderDesign)) || (r.type === "embSpecs" && !designHasEmb(renderDesign))),
    (r) => "dropped empty " + r.type
  )

  const seen = new Set()
  regions = filterTree(
    regions,
    (r) => {
      if (!SINGLETONS.has(r.type)) return true
      if (seen.has(r.type)) return false
      seen.add(r.type)
      return true
    },
    (r) => "deduped " + r.type
  )

  // Insert missing mandatory (contract + design-conditional, gated on the
  // page actually being a design page).
  const mandatory = [...contract.mandatory]
  if (family === "design") {
    if (designHasColors(condDesign)) mandatory.push("colorSpecs")
    if (designHasEmb(condDesign)) mandatory.push("embSpecs")
  }
  const present = new Set(flattenRegions(regions).map((r) => r.type))
  const defaults = {
    header: { type: "header", weight: 10 },
    titleBar: { type: "titleBar", weight: 5 },
    disclaimer: { type: "disclaimer", weight: 8 },
    partsList: { type: "partsList", weight: 30 },
    colorSpecs: { type: "colorSpecs", weight: 25 },
    embSpecs: { type: "embSpecs", weight: 25 },
    documentIndex: { type: "documentIndex", weight: 80 },
    illustration: {
      type: "illustration",
      weight: 60,
      slots: family === "cover" || family === "design" ? 1 : 2,
      refs: condDesign ? [condDesign.pos || "Ubicación"] : family === "cover" ? [(ctx && ctx.garmentType) || "Vista general"] : ["Frente", "Espalda"],
    },
  }
  for (const t of mandatory) {
    if (!present.has(t) && defaults[t]) {
      regions.push({ ...defaults[t] })
      repairs.push("inserted " + t)
    }
  }

  // Canonical chrome order: header, titleBar, [content in authored order],
  // disclaimer.
  const before = regions.map((r) => r.type).join(",")
  const pick = (t) => regions.find((r) => r.type === t)
  const header = pick("header")
  const titleBar = pick("titleBar")
  const disclaimer = pick("disclaimer")
  const middle = regions.filter((r) => r !== header && r !== titleBar && r !== disclaimer)
  const reordered = [header, titleBar, ...middle, disclaimer].filter(Boolean)
  if (reordered.map((r) => r.type).join(",") !== before) repairs.push("reordered chrome")

  const priorities = contract.priorityRank || {}
  function applyPriorities(regs) {
    return regs.map((region) => {
      if (region.type === "split" && Array.isArray(region.regions)) {
        return { ...region, regions: applyPriorities(region.regions) }
      }
      const fallback = priorities[region.type] || 1
      const priority = normalizePriority(region.priority, fallback)
      if (region.priority !== priority) repairs.push("set priority " + region.type + "=" + priority)
      return { ...region, priority }
    })
  }

  return { page: { ...page, regions: applyPriorities(reordered) }, repairs }
}

// ── Document-level contract ──────────────────────────────────────────────────

const MAX_PARTS_PER_STRUCTURAL_PAGE = 8

function isFullBomPage(p) {
  const fam = purposeFamily(p && p.purpose)
  const restricted = Array.isArray(p && p.pieces) && p.pieces.length > 0
  return (fam === "overview" || fam === "structure" || fam === "lining") && !restricted
}

function isBomFamilyPage(page) {
  const family = purposeFamily(page && page.purpose)
  return family === "overview" || family === "structure" || family === "lining"
}

function activePartIds(ctx) {
  return ((ctx && ctx.parts) || []).filter((part) => part && part.on !== false && part.id != null).map((part) => String(part.id))
}

function partCoverage(pages, partId) {
  return pages.filter((page) => {
    if (!isBomFamilyPage(page)) return false
    if (!Array.isArray(page.pieces) || page.pieces.length === 0) return true
    return page.pieces.map(String).includes(partId)
  })
}

function designPagesByName(outline) {
  const map = new Map() // lowercased name -> pages[]
  for (const p of (outline && outline.pages) || []) {
    const pur = p && typeof p.purpose === "string" ? p.purpose.trim() : ""
    if (!pur.startsWith("design:")) continue
    const name = pur.slice("design:".length).trim().toLowerCase()
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(p)
  }
  return map
}

export function validateOutline(outline, ctx) {
  const errors = []
  const pages = (outline && outline.pages) || []
  if (!pages.some((p) => p && p.purpose === "cover")) errors.push({ code: "missing-cover" })
  const partIds = activePartIds(ctx)
  if (partIds.length > 0 && !pages.some(isBomFamilyPage)) errors.push({ code: "missing-bom-page" })
  for (const page of pages) {
    if (isBomFamilyPage(page) && Array.isArray(page.pieces) && page.pieces.length > MAX_PARTS_PER_STRUCTURAL_PAGE) {
      errors.push({ code: "part-page-overloaded", detail: page.id })
    }
  }
  for (const partId of partIds) {
    const coverage = partCoverage(pages, partId)
    if (coverage.length === 0) errors.push({ code: "part-uncovered", detail: partId })
    // A legacy unrestricted overview deliberately represents the complete
    // BOM. Exact-once validation applies to the new distributed model.
    if (!pages.some(isFullBomPage) && coverage.length > 1) errors.push({ code: "part-duplicated", detail: partId })
  }

  const byName = designPagesByName(outline)
  for (const d of (ctx && ctx.designs) || []) {
    if (!d || typeof d.name !== "string") continue
    const key = d.name.trim().toLowerCase()
    const covered = byName.get(key) || []
    if (covered.length === 0) errors.push({ code: "design-uncovered", detail: d.name })
    if (covered.length > 1) errors.push({ code: "design-duplicated", detail: d.name })
  }
  return errors
}

export function repairOutline(outline, ctx) {
  const repairs = []
  let pages = (((outline && outline.pages) || []).map((p) => ({ ...p })))

  if (!pages.some((p) => p.purpose === "cover")) {
    pages.unshift({ id: "cover", title: (ctx && ctx.garmentType) || "Tech Pack", purpose: "cover" })
    repairs.push("inserted cover page")
  }

  const partIds = activePartIds(ctx)
  const structuralPages = pages.filter(isBomFamilyPage)
  if (partIds.length > 0 && structuralPages.length === 0) {
    const coverIdx = pages.findIndex((p) => p.purpose === "cover")
    const inserted = partitionPartsBySystem(ctx && ctx.parts, { maxPartsPerPage: 8 })
    pages.splice(coverIdx + 1, 0, ...inserted)
    repairs.push("inserted " + inserted.length + " semantic BOM pages")
  } else if (partIds.length > 0 && !structuralPages.some(isFullBomPage)) {
    pages = pages.flatMap((page) => {
      if (!isBomFamilyPage(page) || !Array.isArray(page.pieces) || page.pieces.length <= MAX_PARTS_PER_STRUCTURAL_PAGE) return [page]
      const split = balancedChunks(page.pieces, MAX_PARTS_PER_STRUCTURAL_PAGE).map((pieces, index) => {
        const number = index + 1
        return {
          ...page,
          id: page.id + "-" + number,
          title: page.title + " · " + number,
          pieces,
        }
      })
      repairs.push("split overloaded structural page " + page.id + " into " + split.length)
      return split
    })
    const seen = new Set()
    pages = pages.filter((page) => {
      if (!isBomFamilyPage(page) || !Array.isArray(page.pieces)) return true
      const unique = page.pieces.map(String).filter((id) => partIds.includes(id) && !seen.has(id))
      unique.forEach((id) => seen.add(id))
      if (unique.length === 0) {
        repairs.push("dropped empty or duplicate structural page " + page.id)
        return false
      }
      if (unique.length !== page.pieces.length) repairs.push("deduplicated pieces on " + page.id)
      page.pieces = unique
      return true
    })
    const uncovered = ((ctx && ctx.parts) || []).filter((part) => part && part.on !== false && !seen.has(String(part.id)))
    if (uncovered.length > 0) {
      const inserted = partitionPartsBySystem(uncovered, { maxPartsPerPage: 8 })
      const firstDesign = pages.findIndex((page) => String(page.purpose || "").startsWith("design:"))
      pages.splice(firstDesign >= 0 ? firstDesign : pages.length, 0, ...inserted)
      repairs.push("inserted " + inserted.length + " pages for uncovered parts")
    }
  }

  const seenDesign = new Set()
  pages = pages.filter((p) => {
    const pur = typeof p.purpose === "string" ? p.purpose.trim() : ""
    if (!pur.startsWith("design:")) return true
    const key = pur.slice("design:".length).trim().toLowerCase()
    if (seenDesign.has(key)) {
      repairs.push("dropped duplicate design page " + key)
      return false
    }
    seenDesign.add(key)
    return true
  })

  for (const d of (ctx && ctx.designs) || []) {
    if (!d || typeof d.name !== "string") continue
    const key = d.name.trim().toLowerCase()
    if (!seenDesign.has(key)) {
      const slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      pages.push({ id: "design-" + slug, title: d.name, purpose: "design:" + d.name })
      seenDesign.add(key)
      repairs.push("inserted design page " + d.name)
    }
  }

  return { outline: { ...outline, pages }, repairs }
}
