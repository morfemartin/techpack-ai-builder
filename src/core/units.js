// Measurement units for design dimensions.
//
// The factory reads ONE unit; the person filling the form thinks in whatever
// they measured with. So a design stores its numbers plus the unit they were
// typed in, and the tech pack prints them converted to the unit chosen for
// output - "I type cm, it prints inches" - without ever rewriting what was
// entered (retyping a converted value back into the field is how rounding
// error accumulates).

export const UNITS = ["mm", "cm", "in"]
export const DEFAULT_UNIT = "mm"

// Everything converts through millimetres, so adding a unit is one entry.
const PER_MM = { mm: 1, cm: 10, in: 25.4 }

export function isUnit(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PER_MM, value)
}

export function normalizeUnit(value, fallback = DEFAULT_UNIT) {
  return isUnit(value) ? value : fallback
}

// Accepts "111.6", "111,6" (comma decimal is normal in es-AR) or a number.
// Returns null for anything that is not a finite number - callers treat null
// as "no measurement", never as 0, so a blank field never prints "0 mm".
export function parseMeasure(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const cleaned = value.trim().replace(",", ".")
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function convertMeasure(value, from, to) {
  const n = parseMeasure(value)
  if (n === null) return null
  const f = normalizeUnit(from)
  const t = normalizeUnit(to)
  if (f === t) return n
  return (n * PER_MM[f]) / PER_MM[t]
}

// Sensible print precision per unit: sub-millimetre detail is noise on a mm
// value but meaningful on an inch one.
const DECIMALS = { mm: 1, cm: 2, in: 3 }

export function formatMeasure(value, unit) {
  const n = parseMeasure(value)
  if (n === null) return ""
  const u = normalizeUnit(unit)
  const fixed = n.toFixed(DECIMALS[u])
  // Trim trailing zeros so 80.0 prints as "80", but 80.25 keeps its detail.
  return fixed.replace(/\.?0+$/, "") + u
}

// The one-line dimension label the tech pack prints. Returns "" when either
// side is missing, so a half-filled design never emits "Ancho 80mm x Alto".
export function formatDimensions(w, h, from, to = from) {
  const cw = convertMeasure(w, from, to)
  const ch = convertMeasure(h, from, to)
  if (cw === null || ch === null) return ""
  const u = normalizeUnit(to)
  const shown = "Ancho " + formatMeasure(cw, u) + " x Alto " + formatMeasure(ch, u)
  // When the output unit differs from what was typed, show the original in
  // parentheses: the person who measured it can still verify their own number.
  const f = normalizeUnit(from)
  if (f === u) return shown
  return shown + " (medido en " + formatMeasure(parseMeasure(w), f) + " x " + formatMeasure(parseMeasure(h), f) + ")"
}
