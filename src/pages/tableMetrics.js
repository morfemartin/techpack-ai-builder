import { wrapLines } from "../core/svgPrimitives.js"
import { PARTS_COL, PRINT, ROW, TABLE, TEXT_PAD } from "../design/metrics.js"
import { normalizeSizeChart } from "../core/sizeChart.js"
import { parseMeasure, convertMeasure, formatMeasure, formatTolerance } from "../core/units.js"

export function effectiveParts(parts, page) {
  const all = Array.isArray(parts) ? parts.filter((part) => part && part.on !== false) : []
  const wanted = page && Array.isArray(page.pieces) ? page.pieces.map(String).filter(Boolean) : []
  if (wanted.length === 0) return all
  const selected = all.filter((part) => wanted.includes(String(part.id)))
  return selected.length > 0 ? selected : all
}

// translate.js sends and receives ONLY the `val` strings, positionally, for
// the whole document (see buildTranslationPayload). This turns that flat
// array into an id-keyed map ONCE, while the full parts list is still in
// hand, so every downstream table can pair a value with its own part instead
// of with whatever sits at the same row number. Mirrors the filter
// buildTranslationPayload applies (`on !== false`), or the two would drift by
// however many parts are switched off.
export function translatedPartsById(allParts, txParts) {
  if (!Array.isArray(txParts) || txParts.length === 0) return null
  const active = (Array.isArray(allParts) ? allParts : []).filter((part) => part && part.on !== false)
  if (active.length !== txParts.length) return null
  const byId = new Map()
  active.forEach((part, index) => {
    if (part && part.id != null) byId.set(String(part.id), txParts[index])
  })
  return byId
}

// Shared by tableMetrics' measuring pass and buildPages' render pass so both
// agree on which value belongs to a row. `fallback` is a thunk: the caller
// keeps its own legacy positional behaviour for the whole-BOM case.
export function lookupTranslatedValue(txPartsById, part, fallback) {
  if (txPartsById && part && part.id != null) {
    const translated = txPartsById.get(String(part.id))
    if (translated !== undefined) return translated
  }
  return fallback()
}

function rowsForColumns({ parts, partLabels, txParts, txPartsById, width }, columns) {
  const safe = Array.isArray(parts) ? parts.filter((part) => part && part.on !== false) : []
  const labels = partLabels || {}
  const translated = Array.isArray(txParts) ? txParts : null
  const labelWidth = Math.max(24, width * (columns.value - columns.label) - TEXT_PAD * 2)
  const valueWidth = Math.max(24, width * (1 - columns.value) - TEXT_PAD * 2)
  return safe.map((part, index) => {
    const name = labels[part.id] || part.customName || "P" + part.id
    // Resolved by id first, exactly like `name` above. translate.js returns a
    // flat array of values covering the WHOLE document (it never sends ids),
    // so `translated[index]` is only correct while this table renders the
    // whole BOM in document order - it silently pairs a page's label with a
    // stranger's value as soon as the page shows a subset. The positional
    // path stays as the fallback for callers that really do render everything
    // (the registered-garment sheets and older tests).
    const value = lookupTranslatedValue(txPartsById, part, () => (translated ? translated[index] : part.val))
    const nameLines = wrapLines(name, labelWidth, PRINT.minFont)
    const valueLines = wrapLines(value || "N/A", valueWidth, PRINT.minFont)
    const lineCount = Math.max(nameLines.length, valueLines.length, 1)
    return {
      part,
      name,
      value,
      nameLines,
      valueLines,
      height: Math.max(ROW.table, lineCount * TABLE.lineHeight + TABLE.verticalPadding),
    }
  })
}

export function partsTableLayout(input) {
  const candidates = Array.from({ length: 19 }, (_, index) => 0.3 + index * 0.01).map((value) => {
    const columns = { ...PARTS_COL, value }
    const rows = rowsForColumns(input, columns)
    const height = ROW.tableHeader + rows.reduce((sum, row) => sum + row.height, 0)
    return { columns, rows, height }
  })
  // First minimize vertical consumption. On ties, preserve more width for the
  // detailed specification, which is normally the longest factory-facing copy.
  return candidates.sort((a, b) => a.height - b.height || a.columns.value - b.columns.value)[0]
}

export function partsRowMetrics(input) {
  return partsTableLayout(input).rows
}

export function partsTableMetrics(input) {
  return partsTableLayout(input)
}

export function partsCapacityForHeight(input, height) {
  const rows = partsRowMetrics(input)
  let used = ROW.tableHeader
  let count = 0
  for (const row of rows) {
    if (used + row.height > height) break
    used += row.height
    count++
  }
  return count
}

// One cell: the value converted to the output unit, or empty/pending markers
// for the render pass to draw distinctly. `pending` covers an unfilled cell
// AND any cell that isn't user-typed and isn't verified yet - "derived"
// (arithmetic from a rule) and "suggested" (an AI-proposed base value) are
// held to the exact same "never print a guess as if it were confirmed" bar.
// See sizeChart.js's chartWarnings, which applies the same rule chart-wide.
function sizeCell(pom, size, outUnit) {
  const n = parseMeasure(pom.values[size])
  if (n === null) return { text: "", pending: true, empty: true }
  const converted = convertMeasure(n, pom.unit, outUnit || pom.unit)
  return { text: formatMeasure(converted, outUnit || pom.unit), pending: pom.source !== "user" && !pom.verified, empty: false }
}

// Fixed-width numeric columns (one per size, plus tolerance) - numbers do not
// wrap, so there is nothing to measure there; only the label column is
// content-aware. Feeds BOTH measure.js's height branch and buildPages.js's
// renderSizeChart, same discipline as partsTableLayout above: one function,
// so the measured height and the drawn height can never disagree.
export function sizeChartTableLayout({ chart, outUnit, width } = {}) {
  const safe = normalizeSizeChart(chart)
  const w = Math.max(200, Number(width) || 300)
  const numericCols = safe.sizes.length + 1 // + tolerance
  const labelWidth = Math.max(60, w * 0.28)
  const numericWidth = Math.max(28, (w - labelWidth) / numericCols)
  const rows = safe.poms.map((pom) => {
    const nameLines = wrapLines(pom.label || "", labelWidth - TEXT_PAD * 2, PRINT.minFont)
    const lineCount = Math.max(nameLines.length, 1)
    return {
      pom,
      nameLines,
      cells: safe.sizes.map((size) => sizeCell(pom, size, outUnit)),
      toleranceText: formatTolerance(pom.tolerance, outUnit || pom.unit),
      height: Math.max(ROW.table, lineCount * TABLE.lineHeight + TABLE.verticalPadding),
    }
  })
  return {
    sizes: safe.sizes,
    baseSize: safe.baseSize,
    constants: safe.constants,
    labelWidth,
    numericWidth,
    rows,
    height: ROW.tableHeader + rows.reduce((sum, row) => sum + row.height, 0),
  }
}

export function sizeChartCapacityForHeight(input, height) {
  const rows = sizeChartTableLayout(input).rows
  let used = ROW.tableHeader
  let count = 0
  for (const row of rows) {
    if (used + row.height > height) break
    used += row.height
    count++
  }
  return count
}
