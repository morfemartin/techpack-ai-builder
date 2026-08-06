import { uid } from "./idGen.js"
import { normalizeFabricColor, madeiraColorsToStops } from "./colorSpecs.js"
import { isEmbTec } from "./helpers.js"
import { buildPlannedPages } from "../pages/interpretPlan.js"

// One garment, N named colorways (e.g. "Fair Green" / "Silver Lake Blue").
// Deliberately NOT a document-set: `renderColorwayDocument` below re-renders
// the SAME plan per colorway and concatenates the pages into one flat array,
// so svgPages/SvgModal/the ZIP exporter need no changes at all - see the
// plan doc for why a document-set abstraction was cut.
export function newColorway(seed = {}) {
  return {
    id: seed.id || "colorway-" + uid(),
    name: String(seed.name || "").trim(),
    fabricColors: Array.isArray(seed.fabricColors) ? seed.fabricColors.map(normalizeFabricColor) : [],
    // Keyed by design.id. A design NOT in here inherits the base colorway's
    // (colorways[0]'s) thread for this colorway - see colorwayWarnings, the
    // deterministic guard that makes that inheritance visible instead of silent.
    threadOverrides: seed.threadOverrides && typeof seed.threadOverrides === "object" ? seed.threadOverrides : {},
  }
}

export function normalizeColorway(raw) {
  return newColorway(raw || {})
}

// Migration path for the old flat `fabricColors` array: becomes colorway 1
// of 1, so the app's saved-.garment format and any in-flight session both
// load into the new shape without a version bump.
export function colorwaysFromFabricColors(arr) {
  return [newColorway({ name: "", fabricColors: Array.isArray(arr) ? arr : [] })]
}

// "Silver Lake Blue" -> "SLB", "Fair Green" -> "FG", "Navy" -> "NAV" - used
// both for the exported page-name prefix and the style-code suffix, so the
// two always agree with each other.
export function suffixFor(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map((w) => w[0]).join("").toUpperCase()
}

// "AA-POLO-001" + "Silver Lake Blue" -> "AA-POLO-001-SLB" - matches the real
// per-colorway style-code convention already used in the user's own
// production docs (AA-POLO-001-FG / AA-POLO-001-SLB).
export function colorwayStyleCode(baseSno, cw) {
  const suffix = suffixFor(cw && cw.name)
  const base = String(baseSno || "").trim()
  if (!suffix) return base
  return base ? base + "-" + suffix : suffix
}

// PURE: returns a NEW ctx for this colorway, the base ctx is never mutated.
// `buildPlannedPages(plan, ctx)` is itself pure given plan+ctx (see
// interpretPlan.js), which is what makes replaying the SAME plan per
// colorway free of extra AI calls - only the ctx changes per replay.
export function applyColorway(ctx, cw) {
  const safeCtx = ctx || {}
  const designs = (Array.isArray(safeCtx.designs) ? safeCtx.designs : []).map((d) => {
    if (!d) return d
    const override = cw.threadOverrides[d.id]
    if (!override) return d
    // Re-derive stopSeq through the SAME call updDesignColors already makes
    // (App.jsx) - a second, independent derivation would let the printed
    // stop sequence disagree with the printed swatches on any colorway but
    // the base one.
    const emb = d.emb ? { ...d.emb, stopSeq: madeiraColorsToStops(override, d.emb.stopSeq) } : d.emb
    return { ...d, colors: override, emb }
  })
  return {
    ...safeCtx,
    fabricColors: cw.fabricColors,
    designs,
    hdr: { ...(safeCtx.hdr || {}), sno: colorwayStyleCode(safeCtx.hdr && safeCtx.hdr.sno, cw) },
  }
}

// The user's own explicit ask: "preguntando si tiene que cambiar de hilo en
// cada color". A colorway beyond the base that leaves an embroidery design
// unmentioned in `threadOverrides` will PRINT with the base thread - that is
// a legitimate outcome (many colorways really do reuse one thread), but it
// must never be silent. One warning per (colorway x uncovered design).
export function colorwayWarnings(colorways, designs) {
  const list = Array.isArray(colorways) ? colorways : []
  const embDesigns = (Array.isArray(designs) ? designs : []).filter((d) => d && isEmbTec(d.tec))
  const warnings = []
  for (let i = 1; i < list.length; i++) {
    const cw = list[i]
    for (const d of embDesigns) {
      if (!cw.threadOverrides[d.id]) {
        warnings.push({ colorwayId: cw.id, colorwayName: cw.name, designId: d.id, designName: d.name })
      }
    }
  }
  return warnings
}

// Only touches the ONE page the outline planner marked data:colorways -
// every construction/design page keeps its title as-is. With a single
// colorway this is a no-op (title untouched), so a one-colorway document
// stays byte-identical to today's output.
function retitleColorwaysPage(plan, cw, inheritedNames) {
  return {
    ...plan,
    pages: plan.pages.map((page) => {
      if (page.purpose !== "data:colorways") return page
      const retitled = { ...page, title: (page.title || "Colores de tela") + " — " + cw.name }
      if (inheritedNames.length === 0) return retitled
      // Visible instead of silent (house rule): a thread inherited from the
      // base colorway must never look identical to one someone confirmed for
      // THIS colorway - see colorwayWarnings for what counts as "inherited".
      const note = "Hilo heredado del colorway base - confirmar: " + inheritedNames.join(", ")
      return { ...retitled, regions: [...(retitled.regions || []), { type: "note", note }] }
    }),
  }
}

// Replays ONE already-planned document, once per colorway, and concatenates
// the pages. Zero extra AI calls: the plan itself is colorway-independent by
// construction (colors are render-time data, never part of what the planner
// reasons about). `page.colorway` rides along on each page so a future
// per-colorway export filter is a one-line `.filter()`.
export function renderColorwayDocument(plan, ctx, colorways, opts) {
  const list = Array.isArray(colorways) && colorways.length > 0 ? colorways : colorwaysFromFabricColors(ctx && ctx.fabricColors)
  const multi = list.length > 1
  const warnings = multi ? colorwayWarnings(list, ctx && ctx.designs) : []
  return list.flatMap((cw) => {
    const inherited = warnings.filter((w) => w.colorwayId === cw.id).map((w) => w.designName)
    const cwPlan = multi ? retitleColorwaysPage(plan, cw, inherited) : plan
    return buildPlannedPages(cwPlan, applyColorway(ctx, cw), opts).map((page) => ({
      ...page,
      name: multi ? suffixFor(cw.name) + "-" + page.name : page.name,
      colorway: cw.id,
    }))
  })
}
