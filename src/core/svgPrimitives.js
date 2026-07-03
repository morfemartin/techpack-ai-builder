import { palette, type } from "../design/tokens.js"

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
// that IS a value (codes, mm, hex, counts) rather than descriptive text - see
// docs/UX-DESIGN.md §4 for why (0/O, 1/l/I disambiguation + column alignment).
export const TX = (x, y, txt, sz, bold, anchor, color, family) =>
  "<text x='" + x + "' y='" + y + "' text-anchor='" + (anchor || "start") + "' dominant-baseline='central' font-family='" + (family || type.svgFonts.ui) + "' font-size='" + sz + "' font-weight='" + (bold ? "bold" : "normal") + "' fill='" + (color || palette.ink.hex) + "'>" + sv(txt) + "</text>"

// A quiet structural label cell (SEASON, STYLE NO, ...): white fill + ink
// border + bold ink text - part of the retícula itself, not a colored chip.
// Color is reserved for the roles that actually need attention (see tokens.js).
export const LBL = (x, y, w, h, txt) => R(x, y, w, h, palette.white.hex, palette.ink.hex, "0.8") + TX(x + w / 2, y + h / 2, txt, 9, true, "middle", palette.ink.hex)

// A value cell holding an actual data value -> mono face.
export const VAL = (x, y, w, h, v) => R(x, y, w, h, palette.white.hex, palette.ink.hex, "0.6") + TX(x + 5, y + h / 2, v || NA, 9, false, "start", palette.ink.hex, type.svgFonts.data)

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
    s += TX(mx, ly, label, 9, true, "middle", red, type.svgFonts.data)
  } else {
    var tx2 = x1 + offset, ty1 = y1, ty2 = y2
    s += "<line x1='" + tx2 + "' y1='" + ty1 + "' x2='" + tx2 + "' y2='" + ty2 + "' stroke='" + red + "' stroke-width='1.2'/>"
    s += "<polygon points='" + (tx2 - aw / 2) + "," + (ty1 + ah) + " " + (tx2 + aw / 2) + "," + (ty1 + ah) + " " + tx2 + "," + ty1 + "' fill='" + red + "'/>"
    s += "<polygon points='" + (tx2 - aw / 2) + "," + (ty2 - ah) + " " + (tx2 + aw / 2) + "," + (ty2 - ah) + " " + tx2 + "," + ty2 + "' fill='" + red + "'/>"
    s += "<line x1='" + (tx2 - 10) + "' y1='" + ty1 + "' x2='" + (tx2 + 10) + "' y2='" + ty1 + "' stroke='" + red + "' stroke-width='0.8' stroke-dasharray='2,2'/>"
    s += "<line x1='" + (tx2 - 10) + "' y1='" + ty2 + "' x2='" + (tx2 + 10) + "' y2='" + ty2 + "' stroke='" + red + "' stroke-width='0.8' stroke-dasharray='2,2'/>"
    var my = (ty1 + ty2) / 2
    s += R(tx2 - 30, my - 9, 60, 18, palette.white.hex, "none")
    s += TX(tx2, my, label, 9, true, "middle", red, type.svgFonts.data)
  }
  return s
}

/* ---- HEADER / DISCLAIMER BLOCKS (garment-agnostic) ---- */
export function svgHeader(hdr, logo, W, hH) {
  var s = ""
  // Logo slot: pure white (print-first), ink border. Muted placeholder text
  // when no logo was uploaded - not a brand/role color, just a chrome hint.
  s += R(0, 0, 88, hH, palette.white.hex, palette.ink.hex, "0.8")
  if (logo) s += "<image href='" + logo + "' x='4' y='4' width='80' height='" + (hH - 8) + "' preserveAspectRatio='xMidYMid meet'/>"
  else s += TX(44, hH / 2, "LOGO", 9, false, "middle", "#9AA0AB")
  var x = 88
  ;[["SEASON", hdr.season, 58, 100], ["STYLE NO", hdr.sno, 62, 95], ["CATEGORY", hdr.cat, 68, 90], ["FABRIC", hdr.fab, 54, 130], ["FACTORY", hdr.fac, 56, 100]].forEach(function (row) {
    var lw = row[2], vw = row[3], w = vw || (W - x - lw)
    s += LBL(x, 0, lw, hH / 2, row[0]) + VAL(x + lw, 0, w, hH / 2, row[1])
    x += lw + w
  })
  x = 88
  ;[["BRAND", hdr.brand, 50, 88], ["NAME", hdr.pname, 48, 510], ["INPUT", hdr.ind, 48, 85], ["OUTPUT", hdr.outd, 54, 100]].forEach(function (row) {
    var lw = row[2], vw = row[3], w = vw || (W - x - lw)
    s += LBL(x, hH / 2, lw, hH / 2, row[0]) + VAL(x + lw, hH / 2, w, hH / 2, row[1])
    x += lw + w
  })
  return s
}

export function svgDisc(t, hdr, W, dy, discH) {
  return R(0, dy, W, discH, palette.white.hex, palette.ink.hex, "0.8") + TX(W / 2, dy + discH / 2, t.disc + " " + (hdr.brand || "[Marca]") + t.discSfx, 9, false, "middle", palette.ink.hex)
}
