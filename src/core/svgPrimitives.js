import { palette, type } from "../design/tokens.js"
import { BAR, CHIP, HEADER, INSET, PRINT, headerCells } from "../design/metrics.js"

export const NA = "N/A"

export const sv = (v) =>
  String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")

export const R = (x, y, w, h, fill, stroke, sw) =>
  "<rect x='" + x + "' y='" + y + "' width='" + w + "' height='" + h + "' fill='" + fill + "' stroke='" + (stroke || palette.ink.hex) + "' stroke-width='" + (sw || "0.6") + "'/>"

// `family` defaults to the UI grotesque; pass type.svgFonts.data for anything
// that IS a value (codes, hex, mm, counts) rather than descriptive text - see
// docs/UX-DESIGN.md §4 for why (0/O, 1/l/I disambiguation + column alignment).
// `tracking` (optional, px) adds letter-spacing - display/title lockups only.
export const TX = (x, y, txt, sz, bold, anchor, color, family, tracking) =>
  "<text x='" + x + "' y='" + y + "' text-anchor='" + (anchor || "start") + "' dominant-baseline='central' font-family='" + (family || type.svgFonts.ui) + "' font-size='" + sz + "' font-weight='" + (bold ? "bold" : "normal") + (tracking ? "' letter-spacing='" + tracking : "") + "' fill='" + (color || palette.ink.hex) + "'>" + sv(txt) + "</text>"

// One numbered index chip for the whole system (role.index): solid red square,
// centered white mono numeral. Same mark in a parts row, an illustration slot,
// or a wizard step - cross-referenced by number, found first on the sheet.
export function svgChip(cx, cy, label, size) {
  var c = size || CHIP
  return (
    R(cx - c / 2, cy - c / 2, c, c, palette.red.hex, palette.red.hex, "0") +
    TX(cx, cy, label, PRINT.minFont, true, "middle", palette.white.hex, type.svgFonts.data)
  )
}

// Inner section title bar (PANTONE / CMYK, embroidery sheet...): role.priority
// blue, FULL block width, left-aligned label at the shared INSET - the same
// grammar as the page titleBar, so every blue bar on a page shares edges and
// alignment instead of each block inventing its own inset.
export function svgSectionBar(x, y, w, title) {
  return R(x, y, w, BAR.h, palette.blue.hex, "none") + TX(x + INSET, y + BAR.h / 2, title, BAR.fontSize, true, "start", palette.white.hex, undefined, 0.6)
}

// A quiet structural label cell (SEASON, STYLE NO, ...): white fill + ink
// border + bold ink text - part of the retícula itself, not a colored chip.
// Color is reserved for the roles that actually need attention (see tokens.js).
export const LBL = (x, y, w, h, txt) => R(x, y, w, h, palette.white.hex, palette.ink.hex, "0.8") + TX(x + w / 2, y + h / 2, txt, PRINT.minFont, true, "middle", palette.ink.hex)

// A value cell holding an actual data value -> mono face.
export const VAL = (x, y, w, h, v) => R(x, y, w, h, palette.white.hex, palette.ink.hex, "0.6") + TX(x + 5, y + h / 2, v || NA, PRINT.minFont, false, "start", palette.ink.hex, type.svgFonts.data)

/* ---- DIMENSION LINE SVG ---- */
// role.index (red): a precision reference mark, same family as callouts/POM
// numbers. The measurement text is a value -> mono.
export function dimLine(x1, y1, x2, y2, label, offset, horiz) {
  var s = ""
  var aw = 6, ah = 10
  var red = palette.red.hex
  if (horiz) {
    var lx = x1, rx = x2, ly = y1 + offset
    s += "<line x1='" + lx + "' y1='" + ly + "' x2='" + rx + "' y2='" + ly + "' stroke='" + red + "' stroke-width='1.2'/>"
    s += "<polygon points='" + (lx + ah) + "," + (ly - aw / 2) + " " + (lx + ah) + "," + (ly + aw / 2) + " " + lx + "," + ly + "' fill='" + red + "'/>"
    s += "<polygon points='" + (rx - ah) + "," + (ly - aw / 2) + " " + (rx - ah) + "," + (ly + aw / 2) + " " + rx + "," + ly + "' fill='" + red + "'/>"
    s += "<line x1='" + lx + "' y1='" + (ly - 10) + "' x2='" + lx + "' y2='" + (ly + 10) + "' stroke='" + red + "' stroke-width='0.8' stroke-dasharray='2,2'/>"
    s += "<line x1='" + rx + "' y1='" + (ly - 10) + "' x2='" + rx + "' y2='" + (ly + 10) + "' stroke='" + red + "' stroke-width='0.8' stroke-dasharray='2,2'/>"
    var mx = (lx + rx) / 2
    s += R(mx - 22, ly - 9, 44, 18, palette.white.hex, "none")
    s += TX(mx, ly, label, PRINT.minFont, true, "middle", red, type.svgFonts.data)
  } else {
    var tx2 = x1 + offset, ty1 = y1, ty2 = y2
    s += "<line x1='" + tx2 + "' y1='" + ty1 + "' x2='" + tx2 + "' y2='" + ty2 + "' stroke='" + red + "' stroke-width='1.2'/>"
    s += "<polygon points='" + (tx2 - aw / 2) + "," + (ty1 + ah) + " " + (tx2 + aw / 2) + "," + (ty1 + ah) + " " + tx2 + "," + ty1 + "' fill='" + red + "'/>"
    s += "<polygon points='" + (tx2 - aw / 2) + "," + (ty2 - ah) + " " + (tx2 + aw / 2) + "," + (ty2 - ah) + " " + tx2 + "," + ty2 + "' fill='" + red + "'/>"
    s += "<line x1='" + (tx2 - 10) + "' y1='" + ty1 + "' x2='" + (tx2 + 10) + "' y2='" + ty1 + "' stroke='" + red + "' stroke-width='0.8' stroke-dasharray='2,2'/>"
    s += "<line x1='" + (tx2 - 10) + "' y1='" + ty2 + "' x2='" + (tx2 + 10) + "' y2='" + ty2 + "' stroke='" + red + "' stroke-width='0.8' stroke-dasharray='2,2'/>"
    var my = (ty1 + ty2) / 2
    s += R(tx2 - 30, my - 9, 60, 18, palette.white.hex, "none")
    s += TX(tx2, my, label, PRINT.minFont, true, "middle", red, type.svgFonts.data)
  }
  return s
}

/* ---- HEADER / DISCLAIMER BLOCKS (garment-agnostic) ---- */
// Both rows are laid on ONE column grid (metrics.js HEADER): after the fixed
// logo cell, the width divides into 5 equal modules; the top row spans
// [1,1,1,1,1] and the bottom row [1,2,1,1], so every bottom-row cell edge
// lands exactly on a top-row edge and both rows fill the page flush to the
// right margin. The old version gave each row ad-hoc cell widths - the rows
// ended at different x positions and no edges aligned.
export function svgHeader(hdr, logo, W, hH) {
  var s = ""
  // Logo slot: pure white (print-first), ink border. Muted placeholder text
  // when no logo was uploaded - not a brand/role color, just a chrome hint.
  s += R(0, 0, HEADER.logo, hH, palette.white.hex, palette.ink.hex, "0.8")
  if (logo) s += "<image href='" + logo + "' x='4' y='4' width='" + (HEADER.logo - 8) + "' height='" + (hH - 8) + "' preserveAspectRatio='xMidYMid meet'/>"
  else s += TX(HEADER.logo / 2, hH / 2, "LOGO", PRINT.minFont, false, "middle", "#9AA0AB")

  function headerRow(cells, fields, y) {
    var out = ""
    cells.forEach(function (cell, i) {
      var lw = Math.min(HEADER.label, cell.w)
      out += LBL(cell.x, y, lw, hH / 2, fields[i][0]) + VAL(cell.x + lw, y, cell.w - lw, hH / 2, fields[i][1])
    })
    return out
  }

  s += headerRow(headerCells(W, HEADER.topSpans), [["SEASON", hdr.season], ["STYLE NO", hdr.sno], ["CATEGORY", hdr.cat], ["FABRIC", hdr.fab], ["FACTORY", hdr.fac]], 0)
  s += headerRow(headerCells(W, HEADER.bottomSpans), [["BRAND", hdr.brand], ["NAME", hdr.pname], ["INPUT", hdr.ind], ["OUTPUT", hdr.outd]], hH / 2)
  return s
}

export function svgDisc(t, hdr, W, dy, discH) {
  return R(0, dy, W, discH, palette.white.hex, palette.ink.hex, "0.8") + TX(W / 2, dy + discH / 2, t.disc + " " + (hdr.brand || "[Marca]") + t.discSfx, PRINT.minFont, false, "middle", palette.ink.hex)
}

// Shrinks font size (within [minSize,maxSize]) until the wrapped text fits
// inside maxHeight at maxWidth - the fix for text that "se pica" (overlaps)
// or gets silently cut: a block ALWAYS gets a legible size that actually
// fits, instead of a fixed size plus a hard line-count cap that drops words.
// Only at the floor size (min legible) does it fall back to clipping lines,
// as an explicit last resort rather than the default behavior.
export function fitText(text, maxWidth, maxHeight, opts) {
  var o = opts || {}
  var maxSize = o.maxSize || 11
  var minSize = o.minSize || PRINT.minFont
  var lineHeightRatio = o.lineHeightRatio || 1.35
  var raw = text == null ? "" : String(text)
  if (!raw) return { size: maxSize, lineHeight: Math.round(maxSize * lineHeightRatio), lines: [] }
  for (var size = maxSize; size >= minSize; size--) {
    var lh = Math.round(size * lineHeightRatio)
    var lines = wrapLines(raw, maxWidth, size)
    if (lines.length * lh <= maxHeight) return { size: size, lineHeight: lh, lines: lines }
  }
  var floorLh = Math.round(minSize * lineHeightRatio)
  var maxLines = Math.max(1, Math.floor(maxHeight / floorLh))
  return { size: minSize, lineHeight: floorLh, lines: wrapLines(raw, maxWidth, minSize).slice(0, maxLines) }
}

// Word-wraps plain text into lines that roughly fit `maxWidth` px at
// `fontSize`. No real text measurement is available here (this builds raw
// SVG <text> strings, in both browser and Node/vitest) - avgCharWidth is a
// practical heuristic for this project's UI sans-serif, not exact metrics.
export const wrapLines = (text, maxWidth, fontSize) => {
  if (text == null || text === "") return []
  const avgCharWidth = fontSize * 0.55
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth))
  const words = String(text).split(/\s+/)
  const lines = []
  let currentLine = ""
  for (const word of words) {
    if (currentLine === "") {
      currentLine = word
    } else if ((currentLine + " " + word).length <= maxCharsPerLine) {
      currentLine += " " + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine !== "") lines.push(currentLine)
  return lines
}
