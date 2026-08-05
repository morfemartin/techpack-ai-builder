import { findMadeiraThreadByCode } from "./madeiraThreads.js"

const HEX = /^#[0-9A-F]{6}$/i
const PANTONE = /(?:PANTONE\s*)?([0-9]{2}-[0-9]{4}\s*(?:TCX|TPG|TPX)|[0-9]{2,4}\s*[CU])\b/i

export function normalizeHex(value, fallback = "#FFFFFF") {
  const raw = String(value || "").trim()
  if (HEX.test(raw)) return raw.toUpperCase()
  return fallback
}

export function normalizeFabricColor(color = {}) {
  const name = String(color.name || "").trim()
  const explicitPantone = String(color.pantoneApprox || "").trim()
  const nameMatch = name.match(PANTONE)
  const pantoneApprox = explicitPantone || (nameMatch ? nameMatch[0].toUpperCase() : "")
  const requestedStatus = color.pantoneStatus
  const pantoneStatus = requestedStatus === "verified"
    ? "verified"
    : pantoneApprox
      ? "approximate"
      : "pending"
  return {
    ...color,
    name,
    hex: normalizeHex(color.hex),
    pantoneApprox,
    pantoneStatus,
    source: color.source || "manual",
  }
}

export function hasColorData(color) {
  if (!color || typeof color !== "object") return false
  return Boolean(
    String(color.name || "").trim() ||
    /^#[0-9a-f]{6}$/i.test(String(color.hex || "").trim()) ||
    String(color.pantoneApprox || "").trim()
  )
}

function hashHue(value) {
  let hash = 0
  for (const char of String(value || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

function hslToHex(h, s, l) {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return "#" + rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()
}

export function madeiraDisplayHex(thread = {}) {
  const name = String(thread.name || "").toLowerCase()
  if (/black/.test(name)) return "#171719"
  if (/white/.test(name)) return /natural|cream/.test(name) ? "#F3EFE2" : "#F8F8F4"
  if (/silver|chrome|gray|grey|pewter|cement|smoke/.test(name)) return hslToHex(215, 8, 48 + (hashHue(name) % 28))
  if (/navy|indigo|cobalt|blue|azure|sky|aqua|teal|peacock/.test(name)) return hslToHex(205 + (hashHue(name) % 35), 62, 42 + (hashHue(name + "l") % 22))
  if (/green|mint|lime|fern|moss|clover|olive|sage|celery|avocado|leek|cucumber/.test(name)) return hslToHex(82 + (hashHue(name) % 72), 48, 38 + (hashHue(name + "l") % 28))
  if (/yellow|gold|lemon|corn|sun|brass|wheat/.test(name)) return hslToHex(38 + (hashHue(name) % 20), 72, 48 + (hashHue(name + "l") % 24))
  if (/orange|peach|salmon|copper|pumpkin|coral/.test(name)) return hslToHex(10 + (hashHue(name) % 25), 70, 48 + (hashHue(name + "l") % 23))
  if (/red|ruby|brick|burgundy|rhubarb/.test(name)) return hslToHex(350 + (hashHue(name) % 20), 64, 38 + (hashHue(name + "l") % 22))
  if (/pink|rose|fuchsia|magenta|azalea/.test(name)) return hslToHex(316 + (hashHue(name) % 34), 58, 48 + (hashHue(name + "l") % 26))
  if (/purple|violet|lavender|lilac/.test(name)) return hslToHex(265 + (hashHue(name) % 35), 48, 44 + (hashHue(name + "l") % 28))
  if (/brown|chocolate|latte|tan|sand|ecru|caramel|sienna|oak/.test(name)) return hslToHex(22 + (hashHue(name) % 22), 36, 36 + (hashHue(name + "l") % 30))
  return hslToHex(hashHue(name || thread.code), 42, 52)
}

export function normalizeMadeiraThread(code) {
  const thread = findMadeiraThreadByCode(code)
  if (!thread) return null
  return {
    code: thread.code,
    name: thread.name,
    displayHex: madeiraDisplayHex(thread),
    catalog: "Madeira Classic Rayon No. 40",
    catalogVersion: "electronic-reference-2026",
    displayAccuracy: "screen-reference",
  }
}

export function applyMadeiraThread(color, code) {
  const madeira = normalizeMadeiraThread(code)
  if (!madeira) return color
  return {
    ...color,
    name: "Madeira " + madeira.code + " · " + madeira.name,
    hex: madeira.displayHex,
    madeira,
    source: "madeira-catalog",
  }
}

export function madeiraColorsToStops(colors, previousStops = []) {
  const safePrevious = Array.isArray(previousStops) ? previousStops : []
  const previousCatalog = safePrevious.filter((stop) => stop && stop.madeira && stop.madeira.code)
  const catalogStops = (Array.isArray(colors) ? colors : [])
    .filter((color) => color && color.madeira && color.madeira.code)
    .map((color, index) => ({
      ...(previousCatalog[index] || {}),
      stop: index + 1,
      code: color.madeira.code,
      name: color.madeira.name,
      color: color.madeira.displayHex,
      displayHex: color.madeira.displayHex,
      madeira: color.madeira,
    }))
  const customStops = safePrevious
    .filter((stop) => !stop || !stop.madeira || !stop.madeira.code)
  return [...catalogStops, ...customStops].map((stop, index) => ({ ...stop, stop: index + 1 }))
}

export function pantoneDisplay(color) {
  const normalized = normalizeFabricColor(color)
  if (normalized.pantoneStatus === "verified") return "PANTONE " + normalized.pantoneApprox + " · VERIFICADO"
  if (normalized.pantoneApprox) return "PANTONE APROX. " + normalized.pantoneApprox + " · NO VERIFICADO"
  return "PANTONE: PENDIENTE DE VERIFICAR"
}
