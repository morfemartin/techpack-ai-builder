import { GRID } from "../design/metrics.js"
import { measureRegion, selectedDesign } from "./measure.js"
import { layoutPolicyFor, normalizePriority } from "./pageContracts.js"
import { normalizeSlotBriefs } from "./briefs.js"

const COMPOSABLE = new Set(["illustration", "partsList", "colorSpecs", "embSpecs", "artworkInstructions", "references", "documentIndex", "note"])
const CHROME_TYPES = new Set(["header", "titleBar", "disclaimer", "spacer"])

export const REGION_WIDTH_BANDS = {
  partsList: { min: GRID.span(3), max: GRID.span(4) },
  colorSpecs: { min: GRID.span(2), max: GRID.span(3) },
  embSpecs: { min: GRID.span(3), max: GRID.span(3) },
  artworkInstructions: { min: GRID.span(3), max: GRID.span(3) },
  references: { min: GRID.span(3), max: GRID.span(3) },
  note: { min: GRID.span(3), max: GRID.span(3) },
  documentIndex: { min: GRID.span(3), max: GRID.span(3) },
}

function regionNode(region, width, height) {
  return { kind: "region", region, width, height }
}

function groupNode(axis, children, props = {}) {
  return { kind: "group", axis, gap: GRID.gutter, children, ...props }
}

function measured(region, page, ctx, width) {
  const value = measureRegion(region, page, ctx, width)
  return value.canAbsorb
    ? { natural: 0, min: 0, canAbsorb: true }
    : { natural: Math.max(0, value.natural || 0), min: Math.max(0, value.min || value.natural || 0), canAbsorb: false }
}

function collectRegions(page, ctx) {
  const source = Array.isArray(page && page.regions) ? page.regions : []
  const leaves = []
  function add(region) {
    if (!region || typeof region !== "object") return
    if (region.type === "split") {
      ;(region.regions || []).forEach(add)
      return
    }
    if (COMPOSABLE.has(region.type)) leaves.push(region)
  }
  source.forEach(add)
  const unique = new Map()
  leaves.forEach((region) => { if (!unique.has(region.type)) unique.set(region.type, region) })
  const illustration = unique.get("illustration")
  if (illustration && page.purpose !== "cover" && (ctx && ctx.documentMode) === "illustration-handoff" && !unique.has("artworkInstructions")) {
    unique.set("artworkInstructions", {
      type: "artworkInstructions",
      weight: 1,
      briefs: normalizeSlotBriefs(illustration, page, ctx),
      slots: illustration.slots,
      refs: illustration.refs,
    })
    const design = selectedDesign(page, ctx)
    if (design && design.imageData) unique.set("references", { type: "references", weight: 1 })
  }
  return [...unique.values()]
}

function slotGeometry(illustration, width, height) {
  const slots = Math.max(1, Number(illustration && illustration.slots) || (Array.isArray(illustration && illustration.refs) ? illustration.refs.length : 1))
  const columns = Math.ceil(Math.sqrt(slots))
  const rows = Math.ceil(slots / columns)
  return {
    slots,
    width: (width - GRID.gutter * (columns - 1)) / columns,
    height: (height - GRID.gutter * (rows - 1)) / rows,
  }
}

function candidate(mode, ast, illustration, dataBoxes, dimensions, pageCount = 1) {
  const art = findRegionBox(ast, "illustration")
  const slots = art ? slotGeometry(illustration, art.width, art.height) : { width: 0, height: 0, slots: 0 }
  const overflow = dataBoxes.reduce((sum, item) => sum + Math.max(0, item.measure.min - item.height), 0) + Math.max(0, Number(dimensions.groupOverflow) || 0)
  const complete = overflow === 0
  const slotValid = slots.width >= 240 && slots.height >= 240
  const wastedDataArea = dataBoxes.reduce((sum, item) => sum + item.width * Math.max(0, item.height - item.measure.natural), 0)
  return {
    mode,
    ast,
    valid: complete && slotValid,
    complete,
    slotValid,
    slotWidth: slots.width,
    slotHeight: slots.height,
    illustrationArea: art ? art.width * art.height : 0,
    wastedDataArea,
    overflow,
    pageCount,
    dimensions,
  }
}

function findRegionBox(node, type) {
  if (!node) return null
  if (node.kind === "region" && node.region.type === type) return node
  for (const child of node.children || []) {
    const found = findRegionBox(child, type)
    if (found) return found
  }
  return null
}

function fitColumnBoxes(boxes, height) {
  const gaps = GRID.gutter * Math.max(0, boxes.length - 1)
  const available = Math.max(0, height - gaps)
  const natural = boxes.reduce((sum, item) => sum + item.measure.natural, 0)
  const compressible = boxes.reduce((sum, item) => sum + Math.max(0, item.measure.natural - item.measure.min), 0)
  const excess = Math.max(0, natural - available)
  if (excess === 0 || compressible === 0) return boxes
  return boxes.map((item) => {
    const room = Math.max(0, item.measure.natural - item.measure.min)
    const reduction = Math.min(room, excess * (room / compressible))
    return { ...item, height: item.measure.natural - reduction }
  })
}

function heroRailCandidate(page, ctx, illustration, data, width, height, dataLeft) {
  const heroWidth = GRID.span(5)
  const railWidth = GRID.span(3)
  const measuredBoxes = data.map((region) => {
    const measure = measured(region, page, ctx, railWidth)
    return { region, measure, width: railWidth, height: measure.natural }
  })
  const boxes = fitColumnBoxes(measuredBoxes, height)
  const railHeight = boxes.reduce((sum, item) => sum + item.height, 0) + GRID.gutter * Math.max(0, boxes.length - 1)
  const railMinHeight = boxes.reduce((sum, item) => sum + item.measure.min, 0) + GRID.gutter * Math.max(0, boxes.length - 1)
  const rail = groupNode("column", boxes.map((item) => regionNode(item.region, item.width, item.height)), { width: railWidth, height: Math.min(height, railHeight), align: "start" })
  const hero = regionNode(illustration, heroWidth, height)
  const children = dataLeft ? [rail, hero] : [hero, rail]
  return candidate(data.some((r) => r.type === "partsList") ? "bom-hero" : "hero-rail", groupNode("row", children, { width, height }), illustration, boxes, { widths: children.map((item) => item.width), railHeight, groupOverflow: Math.max(0, railMinHeight - height) })
}

function multiColumnCandidate(page, ctx, illustration, data, width, height, dataLeft) {
  const spans = data.map((region) => region.type === "colorSpecs" ? 2 : 3)
  const dataSpan = spans.reduce((sum, value) => sum + value, 0)
  const heroSpan = GRID.columns - dataSpan
  if (heroSpan < 2) return null
  const heroWidth = GRID.span(heroSpan)
  const boxes = data.map((region, index) => {
    const columnWidth = GRID.span(spans[index])
    const measure = measured(region, page, ctx, columnWidth)
    return { region, measure, width: columnWidth, height: Math.min(height, measure.natural) }
  })
  const hero = regionNode(illustration, heroWidth, height)
  const dataNodes = boxes.map((item) => regionNode(item.region, item.width, item.height))
  const children = dataLeft ? [...dataNodes, hero] : [hero, ...dataNodes]
  return candidate("hero-data-columns", groupNode("row", children, { width, height, align: "start" }), illustration, boxes, { widths: children.map((item) => item.width) })
}

function bottomBandCandidate(page, ctx, illustration, data, width, height) {
  const count = data.length
  const spans = count === 1 ? [8] : count === 2 ? [4, 4] : [2, 3, 3]
  const boxes = data.map((region, index) => {
    const columnWidth = GRID.span(spans[index] || 2)
    const measure = measured(region, page, ctx, columnWidth)
    return { region, measure, width: columnWidth, height: measure.natural }
  })
  const bandHeight = Math.max(0, ...boxes.map((item) => item.height))
  const heroHeight = Math.max(0, height - bandHeight - GRID.gutter)
  const band = groupNode("row", boxes.map((item) => regionNode(item.region, item.width, item.height)), { width, height: bandHeight, align: "start" })
  const ast = groupNode("column", [regionNode(illustration, width, heroHeight), band], { width, height })
  return candidate("hero-bottom-band", ast, illustration, boxes.map((item) => ({ ...item, height: bandHeight })), { heights: [heroHeight, bandHeight] })
}

function compareCandidates(a, b) {
  if (a.complete !== b.complete) return a.complete ? -1 : 1
  if (a.slotValid !== b.slotValid) return a.slotValid ? -1 : 1
  if (a.overflow !== b.overflow) return a.overflow - b.overflow
  if (a.illustrationArea !== b.illustrationArea) return b.illustrationArea - a.illustrationArea
  if (a.wastedDataArea !== b.wastedDataArea) return a.wastedDataArea - b.wastedDataArea
  return a.pageCount - b.pageCount
}

function summarize(candidate) {
  return {
    mode: candidate.mode,
    valid: candidate.valid,
    complete: candidate.complete,
    slotValid: candidate.slotValid,
    slotWidth: Math.round(candidate.slotWidth),
    slotHeight: Math.round(candidate.slotHeight),
    illustrationArea: Math.round(candidate.illustrationArea),
    wastedDataArea: Math.round(candidate.wastedDataArea),
    overflow: Math.round(candidate.overflow),
    ...candidate.dimensions,
  }
}

export function evaluatePageCompositions(page, ctx, dimensions = {}) {
  const width = Number(dimensions.width) || GRID.span(8)
  const height = Number(dimensions.height) || 628
  const policy = layoutPolicyFor(page)
  const regions = collectRegions(page, ctx)
  const illustration = regions.find((region) => region.type === "illustration")
  const data = regions.filter((region) => region.type !== "illustration" && !CHROME_TYPES.has(region.type))
  if (!illustration || data.length === 0) {
    return { page, decision: { mode: "unchanged", reason: "no illustration/data competition", candidates: [] }, ast: null }
  }

  const priority = (region) => normalizePriority(region.priority, (policy.priorityRank && policy.priorityRank[region.type]) || 1)
  const hero = { ...illustration, priority: priority(illustration) }
  const orderedData = data.map((region) => ({ ...region, priority: priority(region) })).sort((a, b) => b.priority - a.priority)
  const dataLeft = policy.dataSide === "left" || orderedData.some((region) => region.type === "partsList")
  const candidates = [
    heroRailCandidate(page, ctx, hero, orderedData, width, height, dataLeft),
    multiColumnCandidate(page, ctx, hero, orderedData, width, height, dataLeft),
    bottomBandCandidate(page, ctx, hero, orderedData, width, height),
  ].filter(Boolean)
  const chosen = candidates.slice().sort(compareCandidates)[0]
  const decision = {
    ...summarize(chosen),
    candidates: candidates.map(summarize),
    reason: chosen.mode === "hero-rail" || chosen.mode === "bom-hero"
      ? "grouped related technical modules in one rail and preserved the largest complete artwork board"
      : chosen.mode === "hero-data-columns"
        ? "independent technical columns were dense enough to justify their width"
        : "a bottom band preserved complete data and the largest valid artwork slots",
  }
  return { page: { ...page, _layoutAst: chosen.ast, _compositionDecision: decision }, decision, ast: chosen.ast }
}

export function optimizePageComposition(page, ctx, dimensions) {
  return evaluatePageCompositions(page, ctx, dimensions).page
}
