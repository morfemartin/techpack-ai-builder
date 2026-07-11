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
        // Which known part ids this page is actually about (e.g. the hood
        // page shows hood pieces, not the whole BOM) - consumed by
        // interpretPlan.js's effectivePartsForPage. Omitted/empty means "all".
        pieces: Array.isArray(page.pieces) ? page.pieces.filter((p) => typeof p === "string" && p.trim()) : undefined,
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
    "Sos director de arte de fichas tecnicas textiles, pensando como un disenador tecnico real. Dada esta prenda y sus elementos, decidi que paginas necesita el documento para que la fabrica no tenga dudas: " +
    "estructura general, forros/vistas abiertas si aplican, etiqueta si aplica, y una pagina por cada diseno discreto. No repitas una pagina generica por cada pieza - agrupa piezas relacionadas (ej. capucha+cordon en una misma pagina de estructura) segun lo que un ilustrador necesitaria ver junto.\n\n" +
    "Prenda: " + safeString(garmentType, "custom") + "\n" +
    "Piezas conocidas (cada una con su id): " + JSON.stringify(parts || []) + "\n" +
    "Disenos conocidos: " + JSON.stringify(designs || []) + "\n" +
    "Idioma: " + lang + "\n\n" +
    "Para cada pagina, ademas indicá \"pieces\": la lista de ids (de 'Piezas conocidas') que esa pagina especificamente cubre - una pagina de estructura general puede listar todas, pero una pagina centrada en un detalle (ej. la capucha) deberia listar solo esos ids, para que su tabla de specs no repita el BOM entero.\n" +
    "Devolve SOLO JSON valido con esta forma exacta, sin markdown:\n" +
    '{"pages":[{"id":"overview","title":"Overview","purpose":"overview","pieces":["id1","id2"],"covers":["opcional"]}]}\n' +
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
    "Sos disenador de layout para fichas tecnicas textiles. Para ESTA pagina, repartí el espacio por jerarquia visual usando solamente este vocabulario cerrado de bloques hoja: " +
    "header, titleBar, illustration, partsList, colorSpecs, embSpecs, note, spacer, disclaimer.\n\n" +
    "Pagina: " + JSON.stringify(page) + "\n" +
    "Contexto: " + JSON.stringify({
      garmentType: context && context.garmentType,
      parts: context && context.parts,
      designs: context && context.designs,
      lang: context && context.lang,
    }) + "\n\n" +
    "Pensá como un disenador de fichas tecnicas REAL. Reglas de oro:\n" +
    "1) La ILUSTRACION es la heroina de casi toda pagina: dale la mayor parte del espacio (weight alto). En illustration, 'slots' = cuantas vistas/detalles del dibujo hacen falta (frente, espalda, interior, close-up de un detalle), 'refs' = el nombre de cada vista, y 'note' = un brief CONCRETO y accionable para el ilustrador humano (que dibujar, desde que vista, que medir/acotar, donde ubicar el arte). El brief NO ocupa espacio propio: va DENTRO de la ilustracion, asi que nunca uses un bloque 'note' suelto para eso.\n" +
    "2) Elegí solo los bloques que ESTA pagina necesita segun su proposito y las piezas/disenos relevantes a ella (no repitas todo en cada pagina). header/titleBar/disclaimer son finos y automaticos: dales weight bajo, el espacio real es para el contenido.\n" +
    "3) Composicion: para poner bloques LADO A LADO usá el compositor \"split\" (su weight es alto; su array \"regions\" son columnas, cada una con weight = ancho relativo). Componé asimetrico tipo ficha: specs/lista angosta junto a ilustracion ancha. Variá la silueta segun el proposito - no hagas todas las paginas igual.\n" +
    "4) Si un bloque quedaria sobre-saturado de datos, es mejor menos densidad: repartí en menos filas o dejá que ocupe su columna, priorizando legibilidad.\n\n" +
    "Vocabulario hoja: header, titleBar, illustration, partsList, colorSpecs, embSpecs, spacer, disclaimer.\n" +
    "Ejemplo (overview de un hoodie): {\"regions\":[{\"type\":\"header\",\"weight\":10},{\"type\":\"titleBar\",\"weight\":5},{\"type\":\"split\",\"weight\":75,\"regions\":[{\"type\":\"partsList\",\"weight\":32},{\"type\":\"illustration\",\"weight\":68,\"slots\":2,\"refs\":[\"Frente\",\"Espalda\"],\"note\":\"Dibujar el hoodie en plano tecnico frente y espalda a la misma escala; acotar el ancho de bolsillo canguro y el largo total desde el hombro.\"}]},{\"type\":\"disclaimer\",\"weight\":8}]}\n\n" +
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
