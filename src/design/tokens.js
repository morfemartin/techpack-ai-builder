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

// ── Primitive palette ────────────────────────────────────────────────────────
// Five values. `grayValue` is the approximate 0–255 gray each maps to when
// printed / photocopied in black & white — they are deliberately spread out so
// the whole system stays legible with no color at all (a hard requirement for a
// factory tech pack). Ramp, lightest → darkest:
//   white 255 › yellow ~200 › red ~121 › blue ~76 › ink ~25
export const palette = {
  white: { hex: "#FFFFFF", grayValue: 255 }, // the printable surface — pure white, for paper
  yellow: { hex: "#F5C518", grayValue: 200 }, // ALWAYS drawn with a black keyline (closest to white in B/W)
  red: { hex: "#E5352B", grayValue: 121 },
  blue: { hex: "#1A3FB0", grayValue: 76 },
  ink: { hex: "#141518", grayValue: 25 },
  // Screen-only: the canvas that frames the white document. Never printed, so
  // it is NOT one of the five brand colors — just a cool tint of the chrome.
  canvas: { hex: "#E8EAEF", grayValue: 233 },
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

// ── Typography — 2 families, 3 roles ─────────────────────────────────────────
// display + ui share one geometric grotesque; data uses a mono to signal the
// computational nature of the values (codes, hex, mm, POMs).
export const type = {
  fonts: {
    display: "'Space Grotesk', system-ui, sans-serif",
    ui: "'Space Grotesk', system-ui, sans-serif",
    data: "'JetBrains Mono', ui-monospace, monospace",
  },
  // Three hierarchies. Sizes in px; tracking in em.
  display: { family: "'Space Grotesk', system-ui, sans-serif", weight: 700, tracking: "-0.01em", transform: "uppercase" },
  ui: { family: "'Space Grotesk', system-ui, sans-serif", weight: 500, tracking: "0" },
  label: { family: "'Space Grotesk', system-ui, sans-serif", weight: 700, tracking: "0.08em", transform: "uppercase" },
  data: { family: "'JetBrains Mono', ui-monospace, monospace", weight: 500, tracking: "0" },
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
