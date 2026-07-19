// ─────────────────────────────────────────────────────────────────────────────
// SHARED SVG METRICS — the single geometric source of truth for every page
// block renderer (parts list, color specs, embroidery specs, headers, bars).
//
// Before this module each renderer invented its own geometry: left insets of
// 8/10/12/14/38/44px, value columns at 0.5/0.52/0.55/38px, six different
// row-height regimes, and a table whose header columns didn't even match its
// own rows. Rules and columns from different blocks never lined up when
// stacked on the same page. Every constant here exists to kill one of those
// divergences — a renderer may not hardcode a geometric constant this module
// already names.
//
// All values sit on the tokens.js 4px micro-grid (space(n)) so row rhythms
// and insets share one modular scale between blocks.
// ─────────────────────────────────────────────────────────────────────────────

import { space } from "./tokens.js"

// A4 landscape at four viewBox units per millimetre. Every exported SVG keeps
// these physical dimensions so Illustrator and print dialogs open it at the
// intended scale instead of treating the viewBox as an arbitrary screen graphic.
export const PAGE = {
  width: 1188,
  height: 840,
  physicalWidth: "297mm",
  physicalHeight: "210mm",
  unitsPerMm: 4,
}

// Eight-column production grid: 8mm page margins, 3mm gutters and exact
// 32.5mm columns. The arithmetic closes perfectly inside A4:
// 32 + (8 * 130) + (7 * 12) + 32 = 1188.
export const GRID = {
  columns: 8,
  margin: 32,
  gutter: 12,
  column: 130,
  baseline: 16,
  verticalGap: 16,
  span(count) {
    const n = Math.max(1, Math.min(8, Number(count) || 1))
    return n * this.column + (n - 1) * this.gutter
  },
}

export const CHROME = {
  header: 64,
  titleBar: 32,
  footer: 24,
  gap: GRID.verticalGap,
}

export const PAGE_BODY = {
  width: GRID.span(8),
  height: PAGE.height - GRID.margin * 2 - CHROME.header - CHROME.titleBar - CHROME.footer - CHROME.gap * 3,
}

export function snapBaseline(value, mode = "ceil") {
  const units = Number(value) / GRID.baseline
  const snapped = mode === "floor" ? Math.floor(units) : mode === "round" ? Math.round(units) : Math.ceil(units)
  return Math.max(0, snapped * GRID.baseline)
}

export const PRINT = {
  minFont: 10, // 2.5mm ~= 7.1pt at the declared physical A4 size
  captionFont: 10,
  bodyFont: 11,
}

// Horizontal content inset inside any block: text, swatches, key/value rows.
// Rules and section bars are FULL-WIDTH (inset 0) — a bar that is 10px
// narrower than the page title bar above it reads as a mistake, not a style.
export const INSET = space(3) // 12

// Gap between a column stop (or a chip/swatch) and the text that follows it.
export const TEXT_PAD = space(1) // 4

// ── Shared column template for tabular blocks ────────────────────────────────
// Fractions of the BLOCK width (not the page), so a narrow side column and a
// full-width band keep the same internal proportions. Header cells and data
// cells MUST use the same stops and the same alignment:
//   index — CENTER of the numbered-chip column ("#")
//   label — LEFT edge of the name/label column (divider drawn here)
//   value — LEFT edge of the value column (divider drawn here)
export const COL = {
  index: 0.11,
  label: 0.21,
  value: 0.5,
}

// ── Row-height scale (multiples of space(1)=4px) ─────────────────────────────
export const ROW = {
  tableHeader: space(4), // 16 — one baseline unit
  table: space(8), // 32 — compact parts-table row (AI-planned pages)
  color: space(8), // 32 — two baseline units
  emb: space(4), // 16 — max embroidery key/value row
  kv: space(5), // 20 — generic key/value row (design page info rows)
}

// One chip size for every numbered index marker (parts rows, illustration
// slots, callout badges use CHIP/2 as circle radius).
export const CHIP = space(4) // 16

// Inner section title bar (PANTONE/CMYK, embroidery sheet): full block width,
// left-aligned white label — the same visual grammar as the page titleBar.
export const BAR = {
  h: space(4), // 16
  fontSize: PRINT.minFont,
}

// ── Header grid — one column module for BOTH rows ────────────────────────────
// svgHeader used to give each row its own ad-hoc cell widths; the rows ended
// at different x positions and no vertical
// edge lined up between them. Now: after the fixed logo cell, the width is
// divided into UNITS equal modules; the top row spans [1,1,1,1,1] and the
// bottom row spans [1,2,1,1], so every bottom-row edge lands exactly on a
// top-row edge and both rows fill the full page width.
export const HEADER = {
  logo: 88,
  units: 5,
  label: space(14), // 56 — every label cell, both rows
  topSpans: [1, 1, 1, 1, 1], // SEASON · STYLE NO · CATEGORY · FABRIC · FACTORY
  bottomSpans: [1, 2, 1, 1], // BRAND · NAME · INPUT · OUTPUT
}

// Column x-stops (absolute px, snapped) for a header row of `spans` inside
// total width W: returns [{x, w}] per cell, last cell absorbing rounding so
// the row always ends flush at W.
export function headerCells(W, spans) {
  const unit = (W - HEADER.logo) / HEADER.units
  const cells = []
  let acc = 0
  for (let i = 0; i < spans.length; i++) {
    const x = Math.round(HEADER.logo + acc * unit)
    const isLast = i === spans.length - 1
    const end = isLast ? W : Math.round(HEADER.logo + (acc + spans[i]) * unit)
    cells.push({ x, w: end - x })
    acc += spans[i]
  }
  return cells
}
