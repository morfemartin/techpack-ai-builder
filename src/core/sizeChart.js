import { uid } from "./idGen.js"
import { parseMeasure, convertMeasure, normalizeUnit } from "./units.js"

// The safety decision for this whole file: the model NEVER emits a filled
// matrix (see sizeChartAI.js). It proposes per-POM grading RULES; this file
// is the deterministic arithmetic that turns one verified base-size value
// plus a rule into every other size - and a human verifies each row before
// it counts as confirmed. A wrong increment is one number a person catches
// on sight ("+3 cm per size" is obviously right or wrong); a wrong 36-cell
// matrix is 36 numbers nobody proofreads. That is the gap between a mistake
// that gets caught and a garment cut wrong.
export const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"]

function round2(n) {
  return Math.round(n * 100) / 100
}

export function newPom(seed = {}) {
  return {
    id: seed.id || "pom-" + uid(),
    label: String(seed.label || "").trim(),
    howToMeasure: String(seed.howToMeasure || "").trim(),
    unit: normalizeUnit(seed.unit, "cm"),
    // {size: numberOrString}. A size absent from this object (not even an
    // empty string) is exactly as "not yet measured" as one that is - see
    // chartWarnings, which reads either the same way via parseMeasure.
    values: seed.values && typeof seed.values === "object" ? { ...seed.values } : {},
    tolerance: seed.tolerance != null && seed.tolerance !== "" ? seed.tolerance : null,
    // "user": someone typed this cell by hand - trusted as-is.
    // "derived": gradeFromBase computed it from a rule - must be verified
    // before it prints without the pending marker (see chartWarnings/
    // renderSizeChart).
    // "suggested": sizeChartAI proposed this base value - nobody measured it
    // on a physical garment, so it is held to the exact same "must verify"
    // bar as a derived cell, never the trusted bar a typed cell gets.
    source: seed.source === "derived" || seed.source === "suggested" ? seed.source : "user",
    verified: !!seed.verified,
  }
}

// A construction measurement that does NOT vary by size (altura del cuello,
// largo del placket) - printed as a caption below the graded matrix instead
// of a column that would be identical across every size.
export function newConstant(seed = {}) {
  return {
    id: seed.id || "const-" + uid(),
    label: String(seed.label || "").trim(),
    value: seed.value != null ? seed.value : "",
    unit: normalizeUnit(seed.unit, "cm"),
  }
}

export function newSizeChart(seed = {}) {
  return {
    baseSize: String(seed.baseSize || "M"),
    sizes: Array.isArray(seed.sizes) && seed.sizes.length > 0 ? seed.sizes.map(String) : DEFAULT_SIZES.slice(),
    poms: Array.isArray(seed.poms) ? seed.poms.map(newPom) : [],
    constants: Array.isArray(seed.constants) ? seed.constants.map(newConstant) : [],
  }
}

export function normalizeSizeChart(raw) {
  return newSizeChart(raw || {})
}

// True once there is real data to print - the gate pageContracts.js uses to
// decide whether a document even HAS a size-chart page. An empty/seed chart
// must never turn a document that never asked for one into a broken layout.
export function hasSizeChartData(chart) {
  return !!(chart && Array.isArray(chart.poms) && chart.poms.length > 0)
}

// PURE arithmetic, both directions from the base size. `increment` is a
// per-size-STEP delta (e.g. "+3cm from XS to S, S to M, ..."), not a total
// spread - so grading OUT from a base in the middle of the size run (M, with
// XS/S below and L/XL/XXL above) subtracts steps below the base index and
// adds them above it, from the SAME single rule.
export function gradeFromBase(pom, { sizes, baseSize, increment, unit } = {}) {
  const safePom = pom || newPom()
  const list = Array.isArray(sizes) && sizes.length > 0 ? sizes : DEFAULT_SIZES
  const base = baseSize || list[Math.floor(list.length / 2)]
  const baseIndex = list.indexOf(base)
  const baseValue = parseMeasure(safePom.values[base])
  const incValue = convertMeasure(increment, unit || safePom.unit, safePom.unit)
  if (baseIndex === -1 || baseValue === null || incValue === null) return safePom
  const values = { ...safePom.values }
  list.forEach((size, index) => {
    if (size === base) return
    values[size] = round2(baseValue + (index - baseIndex) * incValue)
  })
  return { ...safePom, values, source: "derived", verified: false }
}

// Never silent, per house rule: every gap or unconfirmed number a factory
// would need to ask about, surfaced as one warning each - printed on the
// document (renderSizeChart) AND available to the app's own warning banners.
export function chartWarnings(chart) {
  const safe = normalizeSizeChart(chart)
  const warnings = []
  for (const pom of safe.poms) {
    const baseValue = parseMeasure(pom.values[safe.baseSize])
    if (baseValue === null) {
      warnings.push({ type: "missing-base", pomId: pom.id, label: pom.label })
      continue
    }
    const missingSizes = safe.sizes.filter((size) => parseMeasure(pom.values[size]) === null)
    if (missingSizes.length > 0) warnings.push({ type: "empty-cells", pomId: pom.id, label: pom.label, sizes: missingSizes })
    // Anything not typed by hand needs a human to confirm it before it counts
    // as real - a "derived" cell came from arithmetic on a rule, a
    // "suggested" cell came from the model guessing a base value. Different
    // warning type per case so the app's own banners can say WHICH kind of
    // unverified number this is, instead of flattening both into one vague
    // "unverified".
    if (pom.source !== "user" && !pom.verified) {
      warnings.push({ type: pom.source === "suggested" ? "ai-base" : "unverified", pomId: pom.id, label: pom.label })
    }
  }
  return warnings
}

// Recognized size tokens - letter sizes plus the "NXL" extended family
// (2XL, 3XL...) some factories use past XXL. Deliberately does NOT include
// bare numbers here (36, 44...) - those are handled separately in
// sizesFromRangeText, since a lone number is ambiguous outside a range.
const LETTER_SIZE_RE = /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\dXL)$/i
const NUMERIC_SIZE_RE = /^\d{2,3}$/

function normalizeSizeToken(token) {
  return String(token || "").trim().toUpperCase()
}

function midSize(sizes) {
  return sizes[Math.floor(sizes.length / 2)]
}

// Parses a free-text answer to the "rango de talles" question (chat/CSV) or
// a garment's "Tallas" part row into a concrete size run - or returns null
// when it can't confidently do so. NEVER invents a size run out of an
// ambiguous answer ("Talle unico", "Prenda de referencia") - null means the
// caller keeps DEFAULT_SIZES/base "M", exactly as if this function did not
// exist. That "return null, change nothing" contract is the whole safety
// property here, mirroring how proposeGrading/proposeBaseValues degrade to
// "propose nothing" rather than guess.
export function sizesFromRangeText(text) {
  const raw = String(text || "").trim()
  if (!raw) return null

  // An explicit "base M" / "base: M" clause, wherever it appears - pulled
  // out BEFORE parsing the size run itself so it is never mistaken for a
  // third size token in a list or range.
  const baseMatch = raw.match(/base\s*:?\s*([A-Za-z0-9]+)/i)
  const explicitBase = baseMatch ? normalizeSizeToken(baseMatch[1]) : null
  const withoutBase = raw.replace(/,?\s*base\s*:?\s*[A-Za-z0-9]+/i, "").trim()

  // Form 1: a delimited list, e.g. "S / M / L / XL" (cap.js's own "Tallas"
  // part default) or "S, M, L, XL". Only recognized if EVERY token is a real
  // size word - one stray token ("S / M / Custom") falls through to null
  // rather than silently dropping the piece it couldn't read.
  if (/[/,]/.test(withoutBase) && !/\b(?:a|to|hasta)\b|-/i.test(withoutBase)) {
    const tokens = withoutBase.split(/[/,]/).map(normalizeSizeToken).filter(Boolean)
    if (tokens.length >= 2 && tokens.every((t) => LETTER_SIZE_RE.test(t))) {
      const baseSize = explicitBase && tokens.includes(explicitBase) ? explicitBase : midSize(tokens)
      return { sizes: tokens, baseSize }
    }
    return null
  }

  // Form 2: a range, e.g. "S a XL" / "XS-XXL" / "S to XL" / "XS hasta XXL".
  const rangeMatch = withoutBase.match(/^([A-Za-z0-9]+)\s*(?:a|to|hasta|-)\s*([A-Za-z0-9]+)$/i)
  if (rangeMatch) {
    const from = normalizeSizeToken(rangeMatch[1])
    const to = normalizeSizeToken(rangeMatch[2])
    if (LETTER_SIZE_RE.test(from) && LETTER_SIZE_RE.test(to)) {
      const fromIndex = DEFAULT_SIZES.indexOf(from)
      const toIndex = DEFAULT_SIZES.indexOf(to)
      if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) return null
      const sizes = DEFAULT_SIZES.slice(fromIndex, toIndex + 1)
      const baseSize = explicitBase && sizes.includes(explicitBase) ? explicitBase : midSize(sizes)
      return { sizes, baseSize }
    }
    // A numeric range ("36 a 44") - no unit system in this app names a step,
    // so this assumes the common even-numbered grading step (2) used for
    // bottoms sizing. Bounded and divisibility-checked so a range this
    // assumption can't honestly cover (an odd span, or a huge one) returns
    // null instead of a wrong guess.
    if (NUMERIC_SIZE_RE.test(from) && NUMERIC_SIZE_RE.test(to)) {
      const min = parseInt(from, 10)
      const max = parseInt(to, 10)
      if (min >= max || max - min > 40 || (max - min) % 2 !== 0) return null
      const sizes = []
      for (let n = min; n <= max; n += 2) sizes.push(String(n))
      const baseSize = explicitBase && sizes.includes(explicitBase) ? explicitBase : midSize(sizes)
      return { sizes, baseSize }
    }
    return null
  }

  return null
}

// A field label this app already uses for a talles answer, across both the
// chat intake (requirementLayers.js's "Base de talles y medidas") and a
// registered garment's own "Tallas" part row (e.g. cap.js) - one scan of
// `parts` covers both, since both land there as {label, val}.
const SIZE_LABEL_HINT = /tall|size|medidas|尺码/i

// Seeds sizes/baseSize from whatever the user already answered, but ONLY
// when the chart is still pristine (nothing typed, nothing added) - editing
// the chart is a stronger signal than a chat answer from three steps ago,
// and this must never clobber it. Returns the chart unchanged when there is
// nothing to seed from or the chart is no longer pristine, so calling this
// on every render of a step is always safe.
export function seedSizesFromParts(chart, parts) {
  const safe = normalizeSizeChart(chart)
  const pristine =
    safe.poms.length === 0 &&
    safe.baseSize === "M" &&
    safe.sizes.length === DEFAULT_SIZES.length &&
    safe.sizes.every((size, index) => size === DEFAULT_SIZES[index])
  if (!pristine) return safe
  const match = (Array.isArray(parts) ? parts : []).find((p) => p && SIZE_LABEL_HINT.test(String(p.label || "")) && String(p.val || "").trim())
  if (!match) return safe
  const parsed = sizesFromRangeText(match.val)
  if (!parsed) return safe
  return { ...safe, sizes: parsed.sizes, baseSize: parsed.baseSize }
}
