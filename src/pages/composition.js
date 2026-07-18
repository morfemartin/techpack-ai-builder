import { measureRegion } from "./measure.js"
import { layoutPolicyFor, normalizePriority } from "./pageContracts.js"

const GAP = 14
const CHROME = new Set(["header", "titleBar", "disclaimer", "spacer"])
const COMPOSABLE = new Set(["illustration", "partsList", "colorSpecs", "embSpecs"])

// Width bands express legibility, not a page template. The allocator starts at
// these minimums, distributes remaining width by contract priority, and honors
// each block's useful maximum. The final proportions therefore change with the
// blocks present instead of being selected by garment or fixture name.
export const REGION_WIDTH_BANDS = {
  partsList: { min: 320, max: 500 },
  colorSpecs: { min: 170, max: 250 },
  embSpecs: { min: 300, max: 420 },
}

function safeMeasure(region, page, ctx, width) {
  const measured = measureRegion(region, page, ctx, width)
  return measured.canAbsorb
    ? { natural: 0, min: 0 }
    : { natural: Math.max(0, measured.natural || 0), min: Math.max(0, measured.min || measured.natural || 0) }
}

function targetRegions(page) {
  const regions = Array.isArray(page && page.regions) ? page.regions : []
  const leaves = []
  const consumed = new Set()
  regions.forEach((region, index) => {
    if (COMPOSABLE.has(region.type)) {
      leaves.push(region)
      consumed.add(index)
      return
    }
    if (region.type !== "split" || !Array.isArray(region.regions) || region.regions.length === 0) return
    if (!region.regions.every((inner) => COMPOSABLE.has(inner.type))) return
    leaves.push(...region.regions)
    consumed.add(index)
  })
  const unique = new Map()
  leaves.forEach((leaf) => {
    if (!unique.has(leaf.type)) unique.set(leaf.type, leaf)
  })
  return { regions, consumed, leaves: [...unique.values()] }
}

function distributeWidths(items, available, policy) {
  const share = policy.illustrationShare || { min: 0.5, max: 0.8 }
  const widths = items.map((item) => {
    if (item.type === "illustration") return available * share.min
    return (REGION_WIDTH_BANDS[item.type] || { min: 220 }).min
  })
  const maxima = items.map((item) => {
    if (item.type === "illustration") return available * share.max
    return (REGION_WIDTH_BANDS[item.type] || { max: Infinity }).max
  })
  if (widths.reduce((sum, value) => sum + value, 0) > available) return null

  let remaining = available - widths.reduce((sum, value) => sum + value, 0)
  const active = new Set(items.map((_, index) => index))
  while (remaining > 0.01 && active.size > 0) {
    const totalPriority = [...active].reduce((sum, index) => sum + items[index].priority, 0)
    if (totalPriority <= 0) break
    let consumed = 0
    for (const index of [...active]) {
      const grant = remaining * (items[index].priority / totalPriority)
      const room = maxima[index] - widths[index]
      const actual = Math.max(0, Math.min(grant, room))
      widths[index] += actual
      consumed += actual
      if (room - actual <= 0.01) active.delete(index)
    }
    if (consumed <= 0.01) break
    remaining -= consumed
  }
  // If every useful maximum was reached, spare width returns to the visual
  // priority rather than becoming an unexplained gutter.
  if (remaining > 0.01) {
    const illustrationIndex = items.findIndex((item) => item.type === "illustration")
    if (illustrationIndex >= 0) widths[illustrationIndex] += remaining
  }
  return widths
}

function replaceTargets(page, target, replacement) {
  const first = Math.min(...target.consumed)
  const regions = []
  target.regions.forEach((region, index) => {
    if (index === first) regions.push(...replacement)
    if (!target.consumed.has(index)) regions.push(region)
  })
  return { ...page, regions }
}

export function evaluatePageCompositions(page, ctx, dimensions = {}) {
  const width = Number(dimensions.width) || 1148
  const height = Number(dimensions.height) || 674
  const policy = layoutPolicyFor(page)
  const target = targetRegions(page)
  const illustration = target.leaves.find((region) => region.type === "illustration")
  const data = target.leaves.filter((region) => region.type !== "illustration" && !CHROME.has(region.type))
  if (!illustration || data.length === 0) return { page, decision: { mode: "unchanged", reason: "no illustration/data competition", candidates: [] } }

  // Notes and any other bounded regions outside the competing illustration /
  // data group have already earned vertical space of their own. Remove that
  // space before evaluating candidates so the compositor never promises more
  // height than the page solver can actually provide.
  const outside = target.regions.filter((region, index) => !target.consumed.has(index) && !CHROME.has(region.type))
  const outsideHeight = outside.reduce((sum, region) => sum + safeMeasure(region, page, ctx, width).natural, 0)
  const workingHeight = Math.max(0, height - outsideHeight - GAP * outside.length)

  const priorityOf = (region) => normalizePriority(region.priority, (policy.priorityRank && policy.priorityRank[region.type]) || 1)
  const dataWithPriority = data.map((region) => ({ ...region, priority: priorityOf(region) }))
  const illustrationWithPriority = { ...illustration, priority: priorityOf(illustration) }

  const stackDataHeight = dataWithPriority.reduce((sum, region) => sum + safeMeasure(region, page, ctx, width).natural, 0)
  const stackGaps = GAP * dataWithPriority.length
  const stackIllustrationHeight = Math.max(0, workingHeight - stackDataHeight - stackGaps)
  const stackComplete = stackDataHeight + stackGaps <= workingHeight
  const stackValid = stackComplete && stackIllustrationHeight >= (policy.minIllustrationHeight || 120)
  const stack = {
    mode: "stack",
    valid: stackValid,
    complete: stackComplete,
    illustrationArea: width * stackIllustrationHeight,
    illustrationHeight: stackIllustrationHeight,
    dataHeight: stackDataHeight,
    availableHeight: workingHeight,
    overflow: Math.max(0, stackDataHeight + stackGaps + (policy.minIllustrationHeight || 120) - workingHeight),
  }

  const orderedForAllocation = [illustrationWithPriority, ...dataWithPriority]
  const availableWidth = width - GAP * (orderedForAllocation.length - 1)
  const widths = distributeWidths(orderedForAllocation, availableWidth, policy)
  const rowMeasures = widths
    ? orderedForAllocation.map((region, index) => region.type === "illustration" ? { natural: workingHeight, min: workingHeight } : safeMeasure(region, page, ctx, widths[index]))
    : []
  const rowNaturals = rowMeasures.map((measure) => measure.natural)
  const rowMinimums = rowMeasures.map((measure) => measure.min)
  const rowOverflow = widths
    ? rowMinimums.reduce((sum, minimum, index) => sum + (orderedForAllocation[index].type === "illustration" ? 0 : Math.max(0, minimum - workingHeight)), 0)
    : Infinity
  const rowIllustrationWidth = widths ? widths[0] : 0
  const row = {
    mode: "row",
    valid: !!widths,
    complete: rowOverflow === 0,
    illustrationArea: rowIllustrationWidth * workingHeight,
    illustrationWidth: rowIllustrationWidth,
    availableHeight: workingHeight,
    overflow: rowOverflow,
    widths,
    naturals: rowNaturals,
    minimums: rowMinimums,
    compressed: rowNaturals.some((natural, index) => orderedForAllocation[index].type !== "illustration" && natural > workingHeight),
  }

  const candidates = [stack, row]
  const completeValid = candidates.filter((candidate) => candidate.valid && candidate.complete)
  const valid = completeValid.length > 0 ? completeValid : candidates.filter((candidate) => candidate.valid)
  const chosen = (valid.length > 0 ? valid : candidates).slice().sort((a, b) => {
    if (a.overflow !== b.overflow) return a.overflow - b.overflow
    return b.illustrationArea - a.illustrationArea
  })[0]

  if (chosen.mode === "stack") {
    const replacement = [illustrationWithPriority, ...dataWithPriority]
    return {
      page: replaceTargets(page, target, replacement),
      decision: { ...chosen, candidates, reason: "maximized illustration area while all bounded blocks remain complete" },
    }
  }

  const columnItems = orderedForAllocation.map((region, index) => ({
    ...region,
    _columnWidth: widths[index],
    _naturalHeight: rowNaturals[index],
  }))
  const columns = policy.dataSide === "left"
    ? [...columnItems.slice(1), columnItems[0]]
    : [columnItems[0], ...columnItems.slice(1)]
  const split = {
    type: "split",
    weight: Math.max(...target.leaves.map((region) => Number(region.weight) || 1)),
    priority: illustrationWithPriority.priority,
    _composition: "constraint-row",
    regions: columns,
  }
  return {
    page: replaceTargets(page, target, [split]),
    decision: { ...chosen, candidates, reason: "stack would violate illustration height or yield less usable illustration area" },
  }
}

export function optimizePageComposition(page, ctx, dimensions) {
  return evaluatePageCompositions(page, ctx, dimensions).page
}
