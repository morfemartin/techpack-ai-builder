import { wrapLines } from "../core/svgPrimitives.js"
import { PARTS_COL, PRINT, ROW, TABLE, TEXT_PAD } from "../design/metrics.js"

export function effectiveParts(parts, page) {
  const all = Array.isArray(parts) ? parts.filter((part) => part && part.on !== false) : []
  const wanted = page && Array.isArray(page.pieces) ? page.pieces.map(String).filter(Boolean) : []
  if (wanted.length === 0) return all
  const selected = all.filter((part) => wanted.includes(String(part.id)))
  return selected.length > 0 ? selected : all
}

function rowsForColumns({ parts, partLabels, txParts, width }, columns) {
  const safe = Array.isArray(parts) ? parts.filter((part) => part && part.on !== false) : []
  const labels = partLabels || {}
  const translated = Array.isArray(txParts) ? txParts : null
  const labelWidth = Math.max(24, width * (columns.value - columns.label) - TEXT_PAD * 2)
  const valueWidth = Math.max(24, width * (1 - columns.value) - TEXT_PAD * 2)
  return safe.map((part, index) => {
    const name = labels[part.id] || part.customName || "P" + part.id
    const value = translated ? translated[index] : part.val
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
