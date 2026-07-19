import { wrapLines } from "../core/svgPrimitives.js"
import { COL, PRINT, ROW, TEXT_PAD, snapBaseline } from "../design/metrics.js"

export function effectiveParts(parts, page) {
  const all = Array.isArray(parts) ? parts.filter((part) => part && part.on !== false) : []
  const wanted = page && Array.isArray(page.pieces) ? page.pieces.map(String).filter(Boolean) : []
  if (wanted.length === 0) return all
  const selected = all.filter((part) => wanted.includes(String(part.id)))
  return selected.length > 0 ? selected : all
}

export function partsRowMetrics({ parts, partLabels, txParts, width }) {
  const safe = Array.isArray(parts) ? parts.filter((part) => part && part.on !== false) : []
  const labels = partLabels || {}
  const translated = Array.isArray(txParts) ? txParts : null
  const labelWidth = Math.max(24, width * (COL.value - COL.label) - TEXT_PAD * 2)
  const valueWidth = Math.max(24, width * (1 - COL.value) - TEXT_PAD * 2)
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
      height: Math.max(ROW.table, snapBaseline(lineCount * 16 + 8)),
    }
  })
}

export function partsTableMetrics(input) {
  const rows = partsRowMetrics(input)
  return { rows, height: ROW.tableHeader + rows.reduce((sum, row) => sum + row.height, 0) }
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
