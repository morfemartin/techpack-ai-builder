import { deepseekChat, deepseekChatStream } from "./deepseekClient.js"
import { parseJSONOrRepair } from "./techpackRequirements.js"
import { normalizePlan } from "../pages/interpretPlan.js"

const ESTIMATED_PAGE_EVENT_BUDGET = 40

function safeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function slug(value, fallback) {
  return safeString(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback
}

function designOutlinePages(designs) {
  const safeDesigns = Array.isArray(designs) ? designs : []
  return safeDesigns.map((d, i) => {
    const name = safeString(d && d.name, "Design " + (i + 1))
    return {
      id: "design-" + slug(name, String(i + 1)),
      title: name,
      purpose: "design:" + name,
      covers: [name],
    }
  })
}

function fallbackOutline({ garmentType, designs }) {
  return {
    pages: [
      {
        id: "overview",
        title: safeString(garmentType, "Garment") + " Overview",
        purpose: "overview",
      },
      ...designOutlinePages(designs),
    ],
  }
}

function normalizeOutline(raw, context) {
  const fallback = fallbackOutline(context || {})
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages) || raw.pages.length === 0) return fallback
  const pages = raw.pages
    .filter((page) => page && typeof page === "object")
    .map((page, i) => {
      const title = safeString(page.title, "Page " + (i + 1))
      const purpose = safeString(page.purpose, i === 0 ? "overview" : "structure")
      return {
        id: slug(page.id || title, "page-" + (i + 1)),
        title,
        purpose,
        covers: Array.isArray(page.covers) ? page.covers.filter((c) => typeof c === "string" && c.trim()) : undefined,
      }
    })
  return pages.length > 0 ? { pages } : fallback
}

export function extractLastCompletedRegionType(text) {
  const re = /"type"\s*:\s*"([^"]+)"/g
  let match
  let last = null
  while ((match = re.exec(text))) last = match[1]
  return last
}

export async function planDocumentOutline({ garmentType, parts, designs, lang = "ES" }) {
  const context = { garmentType, parts, designs, lang }
  const instructions =
    "Sos director de arte de fichas tecnicas textiles. Dada esta prenda y sus elementos, decidi que paginas necesita el documento para que la fabrica no tenga dudas: " +
    "estructura general, forros/vistas abiertas si aplican, etiqueta si aplica, y una pagina por cada diseno discreto.\n\n" +
    "Prenda: " + safeString(garmentType, "custom") + "\n" +
    "Piezas conocidas: " + JSON.stringify(parts || []) + "\n" +
    "Disenos conocidos: " + JSON.stringify(designs || []) + "\n" +
    "Idioma: " + lang + "\n\n" +
    "Devolve SOLO JSON valido con esta forma exacta, sin markdown:\n" +
    '{"pages":[{"id":"overview","title":"Overview","purpose":"overview","covers":["opcional"]}]}\n' +
    "Usa purpose como overview, structure, lining, label, o design:<nombre exacto del diseno>."

  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    maxTokens: 2000,
    temperature: 0.2,
  })
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio un esquema de documento valido.")
  return normalizeOutline(parsed, context)
}

export async function planPageLayout(pageOutline, context, { onProgress } = {}) {
  const page = pageOutline && typeof pageOutline === "object" ? pageOutline : {}
  const instructions =
    "Sos disenador de layout para fichas tecnicas textiles. Para ESTA pagina, repartí el espacio por jerarquia visual usando solamente este vocabulario cerrado de bloques: " +
    "header, titleBar, illustration, partsList, colorSpecs, embSpecs, note, spacer, disclaimer.\n\n" +
    "Pagina: " + JSON.stringify(page) + "\n" +
    "Contexto: " + JSON.stringify({
      garmentType: context && context.garmentType,
      parts: context && context.parts,
      designs: context && context.designs,
      lang: context && context.lang,
    }) + "\n\n" +
    "Cada region necesita type y weight. illustration puede incluir slots, refs y note. note debe ser una instruccion breve para el disenador humano.\n" +
    "Ejemplo: {\"regions\":[{\"type\":\"header\",\"weight\":10},{\"type\":\"illustration\",\"weight\":60,\"slots\":3,\"note\":\"Mostrar frente, espalda y vista interior.\"},{\"type\":\"partsList\",\"weight\":20},{\"type\":\"disclaimer\",\"weight\":10}]}\n\n" +
    "Devolve SOLO JSON valido con esta forma exacta, sin markdown:\n" +
    '{"regions":[{"type":"header","weight":10}]}'

  const call = onProgress
    ? deepseekChatStream({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 2500,
        temperature: 0.2,
        onEvent: ({ contentSoFar, tokensSoFar }) => {
          onProgress({
            percent: Math.min(100, Math.round((tokensSoFar / ESTIMATED_PAGE_EVENT_BUDGET) * 100)),
            lastLabel: extractLastCompletedRegionType(contentSoFar),
          })
        },
      })
    : deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 2500,
        temperature: 0.2,
      })

  const parsed = parseJSONOrRepair(await call, "El asistente de IA no devolvio un layout de pagina valido.")
  const regions = Array.isArray(parsed && parsed.regions) ? parsed.regions : []
  return normalizePlan({ pages: [{ ...page, regions }] }).pages[0]
}
