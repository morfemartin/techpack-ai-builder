// Perceptual-luminance gray for a single hex. 3- and 6-digit forms supported.
export function hexToGray(hex) {
  var h = String(hex).replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  var y = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  var hx = Math.max(0, Math.min(255, y)).toString(16).padStart(2, "0")
  return "#" + hx + hx + hx
}

// Collapses a finished SVG string to a single legible gray ramp: every #rgb /
// #rrggbb fill, stroke, and stop is mapped to its luminance gray, so the WHOLE
// document - brand roles AND arbitrary user PANTONE swatches - reads correctly
// in black & white. 'none' and named colors are left untouched. This is a pure
// post-processor so no renderer needs a second "mono" code path.
export function toGrayscale(svg) {
  return String(svg).replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, function (m) { return hexToGray(m) })
}

// hex -> CMYK (naive, print-approximation conversion used across the whole app)
export const h2c = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  }
}
