// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — single source of truth for the whole app.
//
// This file is imported by BOTH the React UI (inline styles + injected CSS
// custom properties) AND the SVG page generators, so the on-screen interface
// and the printed tech pack share one palette, one type system, and one grid.
//
// The design is Bauhaus: geometric, gridded, flat (no shadows), zero radius.
// Its defining idea is that COLOR ENCODES ATTENTION PRIORITY, not decoration —
// see `role` below. Every rule here is meant to be read by code, not by a human
// style guide.
// ─────────────────────────────────────────────────────────────────────────────

// ── Palette presets ───────────────────────────────────────────────────────────
// Only the three ATTENTION accents (index/priority/highlight) and the two
// structural anchors (ink/white) vary by preset - a palette switch is about
// which colors carry meaning, not about restyling the whole system. The
// neutral scale below (grays for rules/muted text/disabled chrome) is
// deliberately NOT part of a preset: those tones were never one of the five
// brand colors even in "bauhaus" (see the neutral scale further down), they
// stay put across presets, same as `shell`/`canvas`.
//
// "bauhaus" is the ORIGINAL five-value set (this file's own y console before
// presets existed) and MUST stay the default so an existing document's colors
// never change under anyone who doesn't touch the switcher - see the
// byte-identical-default guarantee in tokens.test.js.
// grayValue is the ACTUAL perceptual-luminance gray colorUtils.js's
// hexToGray()/toGrayscale() compute for this hex (y = round(0.299r +
// 0.587g + 0.114b)) - not a hand-picked approximation. These were
// hand-authored once and had drifted from what really gets printed (e.g.
// bauhaus red documented as 114, really 91) - a palette picker showing
// "this is the gray you'll get" must show the real number, so they are
// now the computed ones (verified in tokens.test.js against hexToGray
// itself, not just repeated by hand a second time).
export const PALETTES = {
  bauhaus: {
    white: { hex: "#FFFFFF", grayValue: 255 },
    yellow: { hex: "#F5C518", grayValue: 192 },
    red: { hex: "#E11D3A", grayValue: 91 },
    blue: { hex: "#1A3FB0", grayValue: 65 },
    ink: { hex: "#141518", grayValue: 21 },
  },
  // Print-safe monochrome: same roles, no hue at all - for a factory whose
  // proofing is black/white anyway, or a designer who wants the exported SVG
  // to read as ink-only from the start rather than via the separate
  // toGrayscale() post-processor. Kept clearly distinguishable from each
  // other and from white/ink even with no color vision.
  mono: {
    white: { hex: "#FFFFFF", grayValue: 255 },
    yellow: { hex: "#D8D8D8", grayValue: 216 },
    red: { hex: "#3A3A3A", grayValue: 58 },
    blue: { hex: "#6B6B6B", grayValue: 107 },
    ink: { hex: "#141518", grayValue: 21 },
  },
  // A cooler alternate accent set - same B/W-legible spread requirement as
  // bauhaus, just a different hue family (teal/violet/amber instead of
  // red/blue/yellow). A placeholder third option, easy to re-tune to a real
  // client brand by editing just these three hex values.
  signal: {
    white: { hex: "#FFFFFF", grayValue: 255 },
    yellow: { hex: "#F59E0B", grayValue: 167 },
    red: { hex: "#7C3AED", grayValue: 98 },
    blue: { hex: "#0F766E", grayValue: 86 },
    ink: { hex: "#141518", grayValue: 21 },
  },
}

const DEFAULT_PALETTE = "bauhaus"
let activePaletteName = DEFAULT_PALETTE

// ── Primitive palette ────────────────────────────────────────────────────────
// Five values. `grayValue` is the real 0–255 gray each maps to when printed /
// photocopied in black & white (computed via colorUtils.js's hexToGray) —
// they are deliberately spread out so the whole system stays legible with no
// color at all (a hard requirement for a factory tech pack). Ramp, lightest
// → darkest (bauhaus): white 255 › yellow 192 › red 91 › blue 65 › ink 21.
//
// `palette` and `role` below are MUTATED IN PLACE by setPalette(), never
// reassigned - every module that did `import { palette } from "./tokens.js"`
// (dozens of them, screen AND SVG builders alike) holds a reference to this
// SAME object, so mutating its properties is what makes a palette switch
// reach code that already imported it, without threading a palette prop
// through the entire app. `export const` couldn't do this any other way -
// reassigning the binding itself is not possible from outside this module.
export const palette = {
  // Cloned (not spread) - a shallow `{...PALETTES[DEFAULT_PALETTE]}` would
  // copy REFERENCES to PALETTES.bauhaus's own sub-objects, so setPalette()'s
  // in-place Object.assign() would corrupt the bauhaus preset entry itself
  // the first time anyone switched away from it.
  white: { ...PALETTES[DEFAULT_PALETTE].white },
  yellow: { ...PALETTES[DEFAULT_PALETTE].yellow },
  red: { ...PALETTES[DEFAULT_PALETTE].red },
  blue: { ...PALETTES[DEFAULT_PALETTE].blue },
  ink: { ...PALETTES[DEFAULT_PALETTE].ink },
  // Screen-only chrome tints — NOT part of the five brand colors, and NOT
  // preset-varying (see the PALETTES comment above):
  //  · shell  = the general app background. Same near-black gray as `ink`
  //    (not pure #000) — reuses the palette instead of inventing a 6th hex.
  //  · canvas = a light muted surface for disabled controls / instruction bars.
  shell: { hex: "#141518", grayValue: 25 },
  canvas: { hex: "#E8EAEF", grayValue: 233 },
}

// ── Neutral scale ─────────────────────────────────────────────────────────────
// Grays used for rules, muted text and disabled chrome across buildPages.js /
// interpretPlan.js / a few form components - previously scattered as magic
// hex literals in each file (not read from any shared token), which is
// exactly what let `#1A3FB0`/`#E5352B` drift in as ad-hoc restatements of
// `role.priority`/`role.index` instead of using the role itself. Centralized
// here so there is one place to look, but deliberately NOT preset-varying
// (see the PALETTES comment) - a mono/signal switch changes the ATTENTION
// colors, not the structural grays underneath them.
export const neutral = {
  faint: { hex: "#F7F7F8" },
  paleBorder: { hex: "#EDEEF0" },
  divider: { hex: "#F0F1F3" },
  line: { hex: "#E4E6EA" },
  mid: { hex: "#B7BCC6" },
  mutedText: { hex: "#9AA0AB" },
  strongText: { hex: "#7D8490" },
}

// ── Semantic roles — the "computational color model" ─────────────────────────
// A UI or SVG element picks a role by WHAT IT IS FOR, never by how it looks.
export const role = {
  // Enumeration / numeric markers the eye must find & count first.
  // Carries white glyphs (bold). Usage: stepper numbers, part "#" markers,
  // SVG callout circles, POM numbers, dimension lines.
  index: { fill: palette.red.hex, on: palette.white.hex },

  // A bounded block of prioritized information. Solid fill, white text on top.
  // Usage: the active wizard step, section header bars (DETAILS), the color /
  // embroidery page title bars.
  priority: { fill: palette.blue.hex, on: palette.white.hex },

  // Highest priority but small — maximum attention, minimum area. ALWAYS with a
  // black keyline so it survives grayscale. Usage: required-empty markers, the
  // current-step dot, "needs action" flags.
  highlight: { fill: palette.yellow.hex, on: palette.ink.hex, keyline: palette.ink.hex },

  // The grid/retícula itself, body text, borders, high-contrast fills.
  structure: { fill: palette.ink.hex, on: palette.white.hex },

  // Printable ground (pure white) and the screen-only canvas behind it.
  surface: { fill: palette.white.hex, on: palette.ink.hex },
  canvas: { fill: palette.canvas.hex, on: palette.ink.hex },
}

// Re-derives every role's hex strings from the (now-mutated) palette object -
// same formulas as the initial `role` literal above, so the ROLE STRUCTURE
// (which concept maps to which slot) never changes, only the hex values do.
function resyncRoles() {
  role.index.fill = palette.red.hex
  role.index.on = palette.white.hex
  role.priority.fill = palette.blue.hex
  role.priority.on = palette.white.hex
  role.highlight.fill = palette.yellow.hex
  role.highlight.on = palette.ink.hex
  role.highlight.keyline = palette.ink.hex
  role.structure.fill = palette.ink.hex
  role.structure.on = palette.white.hex
  role.surface.fill = palette.white.hex
  role.surface.on = palette.ink.hex
  role.canvas.fill = palette.canvas.hex
  role.canvas.on = palette.ink.hex
}

export function getPaletteNames() {
  return Object.keys(PALETTES)
}

export function getActivePaletteName() {
  return activePaletteName
}

// Mutates `palette`/`role` in place (see the comment on `palette` above) and
// re-applies the CSS custom properties so screen chrome authored in CSS
// picks it up too. Callers that read `palette`/`role` at REACT RENDER time
// still need something to trigger a re-render afterward (a plain object
// mutation is invisible to React's change detection) - App.jsx's toggle does
// that with its own state bump; the exported SVG needs nothing extra, since
// it's rebuilt fresh from current token values on every "Generar SVG" click.
export function setPalette(name) {
  const preset = PALETTES[name] ? name : DEFAULT_PALETTE
  activePaletteName = preset
  Object.assign(palette.white, PALETTES[preset].white)
  Object.assign(palette.yellow, PALETTES[preset].yellow)
  Object.assign(palette.red, PALETTES[preset].red)
  Object.assign(palette.blue, PALETTES[preset].blue)
  Object.assign(palette.ink, PALETTES[preset].ink)
  resyncRoles()
  applyCssVars()
  return preset
}

// ── Typography — 2 families, 3 roles ─────────────────────────────────────────
// Both faces are SYSTEM fonts on purpose - no webfont download, no flash of
// unstyled text, and (the part that actually matters for this tool) the
// generated SVG opens with the right typeface in Illustrator/Preview on a
// factory's machine even though nobody there installed a Google Font.
// display + ui share Helvetica's lineage (the grotesque the International
// Typographic Style / late Bauhaus is built on) via the classic cross-platform
// stack; data uses each OS's native monospace to signal the computational
// nature of the values (codes, hex, mm, POMs) - see docs/UX-DESIGN.md §4.
const FONT_UI = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const FONT_DATA = 'ui-monospace, Menlo, Consolas, "Courier New", monospace'

export const type = {
  fonts: {
    display: FONT_UI,
    ui: FONT_UI,
    data: FONT_DATA,
  },
  // Same values, kept as a separate export so callers that need "the SVG-safe
  // font string" stay explicit about it - both are already double-quoted /
  // quote-free internally, so they're safe to embed in the generated SVG's
  // single-quoted XML attributes as-is (font-family='<value>').
  svgFonts: {
    ui: FONT_UI,
    data: FONT_DATA,
  },
  // Three hierarchies. Sizes in px; tracking in em.
  display: { family: FONT_UI, weight: 700, tracking: "-0.01em", transform: "uppercase" },
  ui: { family: FONT_UI, weight: 500, tracking: "0" },
  label: { family: FONT_UI, weight: 700, tracking: "0.08em", transform: "uppercase" },
  data: { family: FONT_DATA, weight: 500, tracking: "0" },
  size: { xs: 11, sm: 12, base: 14, md: 16, lg: 20, xl: 28, xxl: 40 },
}

// ── Space — the micro grid ───────────────────────────────────────────────────
// Fixed 4px base unit for component internals. Macro gutters BETWEEN major
// retículas are expressed as percentages instead (see `pct`), so they scale
// with the format — the layout engine resolves those.
const UNIT = 4
export const space = (n) => n * UNIT
export const pct = (n) => n + "%"

// Zero radius everywhere — Bauhaus has no rounded corners.
export const radius = 0
// Hairline weight for the retícula rules.
export const hairline = 1

// ── CSS custom properties ────────────────────────────────────────────────────
// One source (this file) → CSS vars for anything authored in CSS, and the same
// JS values for the inline-styled React components and the SVG builders.
export function cssVars() {
  return {
    "--c-white": palette.white.hex,
    "--c-yellow": palette.yellow.hex,
    "--c-red": palette.red.hex,
    "--c-blue": palette.blue.hex,
    "--c-ink": palette.ink.hex,
    "--c-shell": palette.shell.hex,
    "--c-canvas": palette.canvas.hex,

    "--role-index": role.index.fill,
    "--role-priority": role.priority.fill,
    "--role-highlight": role.highlight.fill,
    "--role-structure": role.structure.fill,
    "--role-surface": role.surface.fill,

    "--font-display": type.fonts.display,
    "--font-ui": type.fonts.ui,
    "--font-data": type.fonts.data,

    "--space-1": space(1) + "px",
    "--space-2": space(2) + "px",
    "--space-3": space(3) + "px",
    "--space-4": space(4) + "px",
    "--space-6": space(6) + "px",
    "--space-8": space(8) + "px",

    "--radius": radius + "px",
    "--hairline": hairline + "px",
  }
}

export function applyCssVars(root = typeof document !== "undefined" ? document.documentElement : null) {
  if (!root) return
  const vars = cssVars()
  for (const k in vars) root.style.setProperty(k, vars[k])
}
