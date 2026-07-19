import { deepseekChat, deepseekChatStream, getTextAIProvider } from "./deepseekClient.js"
import { parseJSONOrRepair } from "./techpackRequirements.js"
import { normalizePlan } from "../pages/interpretPlan.js"
import { repairOutline, repairPage } from "../pages/pageContracts.js"
import { buildSemanticOutline } from "./semanticOutline.js"
import { deterministicPageLayout } from "./semanticOutline.js"
import { HYBRID_TASKS } from "./hybridTasks.js"

const ESTIMATED_PAGE_EVENT_BUDGET = 40
const REMOTE_PLANNING_TIMEOUT_MS = 45000
const LOCAL_PLANNING_TIMEOUT_MS = 300000

export async function withPlanningTimeout(promise, timeoutMs = getTextAIProvider() === "local" ? LOCAL_PLANNING_TIMEOUT_MS : REMOTE_PLANNING_TIMEOUT_MS) {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("planning_timeout")), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function safeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function slug(value, fallback) {
  return safeString(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback
}

function fallbackOutline({ garmentType, parts, designs }) {
  return buildSemanticOutline({ garmentType, parts, designs })
}

export function fallbackDocumentOutline(context = {}) {
  return repairOutline(fallbackOutline(context), context).outline
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
        system: safeString(page.system, "") || undefined,
        objective: safeString(page.objective, "") || undefined,
        views: Array.isArray(page.views) ? page.views.filter((view) => typeof view === "string" && view.trim()) : undefined,
        briefs: Array.isArray(page.briefs) ? page.briefs.filter((brief) => brief && typeof brief === "object") : undefined,
      }
    })
  return pages.length > 0 ? { pages } : fallback
}

function isStructuralPurpose(purpose) {
  return purpose === "overview" || purpose === "lining" || (typeof purpose === "string" && purpose.startsWith("structure:"))
}

function validStructuralRefinement(sourcePage, pages) {
  if (!Array.isArray(pages) || pages.length < 2) return false
  const expected = Array.isArray(sourcePage.pieces) ? sourcePage.pieces : []
  const received = pages.flatMap((page) => Array.isArray(page.pieces) ? page.pieces : [])
  if (pages.some((page) => !isStructuralPurpose(page.purpose) || page.pieces.length < 2 || page.pieces.length > 8)) return false
  if (received.length !== expected.length || new Set(received).size !== received.length) return false
  const expectedSet = new Set(expected)
  return received.every((id) => expectedSet.has(id)) && expected.every((id) => received.includes(id))
}

function restoreMissingPartsToTheirSystems(outline, parts) {
  const pages = JSON.parse(JSON.stringify((outline && outline.pages) || []))
  const structural = pages.filter((page) => isStructuralPurpose(page.purpose))
  const covered = new Set(structural.flatMap((page) => Array.isArray(page.pieces) ? page.pieces : []))
  const repairs = []

  for (const part of (parts || []).filter((item) => item && item.on !== false && item.id && !covered.has(item.id))) {
    const system = safeString(part.system, "").toLowerCase()
    if (!system) continue
    const target = structural.find((page) => {
      const pageSystem = safeString(page.system, "").toLowerCase()
      const purpose = safeString(page.purpose, "").toLowerCase()
      return pageSystem === system || purpose === "structure:" + system
    })
    if (!target) continue
    target.pieces = [...(target.pieces || []), part.id]
    covered.add(part.id)
    repairs.push("restored " + part.id + " to " + target.id + " before semantic refinement")
  }

  return { outline: { pages }, repairs }
}

async function refineOverloadedStructuralPages(outline, context) {
  const refinements = []
  const pages = []
  const partById = new Map((context.parts || []).map((part) => [part && part.id, part]))

  for (const page of outline.pages || []) {
    if (!isStructuralPurpose(page.purpose) || !Array.isArray(page.pieces) || page.pieces.length <= 8) {
      pages.push(page)
      continue
    }

    const sourceParts = page.pieces.map((id) => partById.get(id)).filter(Boolean)
    const prompt =
      "Sos ingeniero textil. Subdividi UN sistema constructivo grande en paginas tecnicas con objetivos fabricables distintos. " +
      "No dividas por cantidad ni por orden de la lista: conserva juntos pares espejo y componentes que se montan como una unidad. " +
      "Reglas de ensamblaje: la apertura o vista de cada bolsillo va con SU bolsa; un cargo conserva juntos cuerpo, fuelle y capas exterior/interior de tapa; " +
      "un refuerzo va con su panel anfitrion; los componentes izquierda/derecha equivalentes permanecen en la misma pagina. Cada pagina debe contener de 2 a 8 ids. " +
      "Usa cada id exactamente una vez, no inventes ids y devuelve al menos 2 paginas. Titulos, objetivos y vistas deben ser especificos.\n\n" +
      "Sistema original: " + JSON.stringify({ id: page.id, purpose: page.purpose, pieces: page.pieces }) + "\n" +
      "Piezas confirmadas: " + JSON.stringify(sourceParts) + "\n\n" +
      "Devolve SOLO JSON valido: " +
      '{"pages":[{"id":"...","title":"...","purpose":"structure:...","objective":"...","pieces":["P01","P02"],"views":["..."]}]}'

    const attempts = []
    let acceptedPages = null
    let previousRaw = ""
    for (let attempt = 0; attempt < 1 && !acceptedPages; attempt++) {
      try {
        const messages = [{ role: "user", content: prompt }]
        if (attempt > 0) messages.push(
          { role: "assistant", content: previousRaw },
          { role: "user", content: "Esa respuesta incumplio cobertura exacta o el limite de 2 a 8 piezas. Corrigela y verifica cada id antes de responder." }
        )
        const raw = await deepseekChat({
          messages,
          maxTokens: 1800,
          temperature: 0,
          task: HYBRID_TASKS.OUTLINE,
          validator: (content) => {
            const parsed = parseJSONOrRepair(content, "invalid structural refinement")
            return validStructuralRefinement(page, normalizeOutline(parsed, context).pages)
          },
          fallback: JSON.stringify({ pages: [] }),
          providers: context.providers,
        })
        previousRaw = raw
        const parsed = parseJSONOrRepair(raw, "El modelo no devolvio una subdivision estructural valida.")
        const candidate = normalizeOutline(parsed, context).pages
          .filter((item) => Array.isArray(item.pieces) && item.pieces.length > 0)
          .map((item) => ({ ...item, purpose: isStructuralPurpose(item.purpose) ? item.purpose : page.purpose }))
        const accepted = validStructuralRefinement(page, candidate)
        attempts.push({ accepted, raw })
        if (accepted) acceptedPages = candidate
      } catch (error) {
        attempts.push({ accepted: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    refinements.push({ pageId: page.id, accepted: !!acceptedPages, pages: acceptedPages || [], attempts })
    pages.push(...(acceptedPages || [page]))
  }

  return { outline: { pages }, refinements }
}

export function extractLastCompletedRegionType(text) {
  const re = /"type"\s*:\s*"([^"]+)"/g
  let match
  let last = null
  while ((match = re.exec(text))) last = match[1]
  return last
}

export async function planDocumentOutline({ garmentType, parts, designs, brief, lang = "ES" }, { onProposal, onStatus, signal, providers } = {}) {
  const context = { garmentType, parts, designs, brief, lang, providers }
  const instructions =
    "Sos director de arte de fichas tecnicas textiles, pensando como un disenador tecnico real. Decidi que paginas necesita este documento respondiendo, en orden, las preguntas que un disenador se hace:\n" +
    "1. ¿Que merece pagina propia? La portada identifica el estilo; las piezas se dividen por sistemas constructivos con objetivos distintos; cada diseno discreto tiene SU pagina.\n" +
    "2. ¿Que no se repite nunca? Cada id de pieza activa debe aparecer exactamente una vez entre las paginas estructurales. NO concentres un BOM grande en una pagina general si puede dividirse con sentido. Los datos de un diseno viven solo en su pagina.\n" +
    "3. ¿Que agrupo? Piezas que la fabrica monta juntas y que el ilustrador necesita ver juntas (cuerpo, capucha/cuello, mangas/punos, cierres/bolsillos, interior, accesorios). Maximo 8 ids por pagina; si un sistema excede el limite, dividilo en subobjetivos coherentes.\n\n" +
    "Prenda: " + safeString(garmentType, "custom") + "\n" +
    "Piezas conocidas (cada una con su id): " + JSON.stringify(parts || []) + "\n" +
    "Disenos conocidos: " + JSON.stringify(designs || []) + "\n" +
    "Brief textil confirmado (no inventes ni contradigas estos datos): " + JSON.stringify(brief || {}) + "\n" +
    "Idioma: " + lang + "\n\n" +
    "Para cada pagina estructural indica \"pieces\": los ids que cubre, \"objective\": la mision tecnica y \"views\": las vistas necesarias. Cada id debe aparecer exactamente una vez.\n" +
    "Devolve SOLO JSON valido con esta forma exacta, sin markdown:\n" +
    '{"pages":[{"id":"shell-body","title":"Cuerpo exterior","purpose":"structure:shell-body","objective":"Documentar paneles y uniones","pieces":["id1","id2"],"views":["Frente","Espalda"],"covers":["opcional"]}]}\n' +
    "Usa purpose como cover, structure:<sistema>, lining, label, o design:<nombre exacto del diseno>. La primera pagina debe ser la cover."

  let aiResult = null
  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    maxTokens: 4000,
    temperature: 0.2,
    task: HYBRID_TASKS.OUTLINE,
    validator: (content) => {
      const candidate = normalizeOutline(parseJSONOrRepair(content, "invalid outline"), context)
      const activeIds = new Set((parts || []).filter((part) => part && part.on !== false && part.id).map((part) => part.id))
      const covered = candidate.pages.filter((page) => isStructuralPurpose(page.purpose)).flatMap((page) => page.pieces || [])
      const requiredDesigns = (designs || []).filter((design) => design && design.name).map((design) => "design:" + design.name)
      const purposes = new Set(candidate.pages.map((page) => page.purpose))
      return candidate.pages[0] && candidate.pages[0].purpose === "cover" &&
        covered.length === activeIds.size && covered.every((id) => activeIds.has(id)) &&
        new Set(covered).size === covered.length &&
        candidate.pages.every((page) => !page.pieces || page.pieces.length <= 8) &&
        requiredDesigns.every((purpose) => purposes.has(purpose))
    },
    fallback: () => JSON.stringify(fallbackDocumentOutline(context)),
    onStatus,
    signal,
    providers,
    onResult: (result) => { aiResult = result },
  })
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio un esquema de documento valido.")
  const proposed = normalizeOutline(parsed, context)
  const restored = restoreMissingPartsToTheirSystems(proposed, parts)
  const refined = await refineOverloadedStructuralPages(restored.outline, context)
  // The model proposes; the document contract disposes: a missing cover or
  // BOM page is inserted, uncovered designs get their page, duplicates drop.
  const repaired = repairOutline(refined.outline, context)
  const repairs = [...restored.repairs, ...repaired.repairs]
  if (typeof onProposal === "function") onProposal({ raw, parsed, proposed, refinements: refined.refinements, outline: repaired.outline, repairs, aiResult })
  return repaired.outline
}

export async function planPageLayout(pageOutline, context, { onProgress, onStatus, signal, providers } = {}) {
  const page = pageOutline && typeof pageOutline === "object" ? pageOutline : {}
  const instructions =
    "Sos disenador de layout para fichas tecnicas textiles. Para ESTA pagina, repartí el espacio por jerarquia visual usando solamente este vocabulario cerrado de bloques hoja: " +
    "header, titleBar, illustration, partsList, colorSpecs, embSpecs, note, spacer, disclaimer.\n\n" +
    "Pagina: " + JSON.stringify(page) + "\n" +
    "Contexto: " + JSON.stringify({
      garmentType: context && context.garmentType,
      parts: context && context.parts,
      designs: context && context.designs,
      brief: context && context.brief,
      lang: context && context.lang,
    }) + "\n\n" +
    "Pensá como un disenador de fichas tecnicas REAL. Antes de componer, respondé mentalmente: ¿como represento ESTA pagina de la manera mas ordenada? ¿que elementos tienen que estar si o si presentes visualmente? ¿que NO repito porque ya vive en otra pagina? Reglas de oro:\n" +
    "1) La ILUSTRACION es la heroina de casi toda pagina y el UNICO bloque que se estira: dale weight alto (su weight es su prioridad de espacio). Los bloques de datos (partsList/colorSpecs/embSpecs/note) miden su altura por su contenido real - su weight no los agranda, asi que no intentes inflarlos. En illustration: 'slots' = cuantas vistas/detalles hacen falta (frente, espalda, interior, close-up), 'refs' = el nombre de cada vista, y 'briefs' = UN brief estructurado POR SLOT que guia al ilustrador humano. Cada brief: {\"garmentPart\": que parte de la prenda va en este slot, \"view\": la vista, \"mustMark\": [elementos que el dibujo DEBE senalar con callouts], \"measurements\": [{\"label\": medida a acotar con lineas de cota en mm, \"perSize\": true si varia por talla}], \"placementLandmark\": desde que referencia se mide la ubicacion (ej. '80mm bajo costura de hombro, centrado'), \"factoryNote\": lo critico para que la fabrica no falle}. Pensá cada brief con DOS cabezas: (a) ¿que tiene que estar dibujado/acotado para que la FABRICA produzca sin errores y fiel a lo que pidio el cliente? (b) ¿que necesita saber un ILUSTRADOR habil que NO sabe de textil para completar los esquemas perfectamente? 'note' queda como resumen narrativo opcional; va DENTRO de la ilustracion - nunca un bloque 'note' suelto para eso.\n" +
    "2) Elegí solo los bloques que ESTA pagina necesita segun su proposito: una cover identifica (ilustracion grande, sin tablas); overview/structure llevan el BOM; una pagina design:<nombre> lleva SOLO los datos de ese diseno (colorSpecs si tiene colores, embSpecs si tiene bordado, nunca el BOM). El sistema valida esto y repara lo que falte o sobre.\n" +
    "3) NO decidas columnas, porcentajes ni splits. Tu trabajo es declarar el CONTENIDO y las vistas; el compositor determinista mide los datos y elige la reticula A4. Los weight se aceptan por compatibilidad pero no controlan la geometria final.\n" +
    "4) Nunca inventes medidas, landmarks o construccion. Si el contexto no lo confirma, omitilo: el handoff lo marcara PENDIENTE DE CONFIRMAR para que el ilustrador no convierta una suposicion en instruccion de fabrica.\n\n" +
    "Vocabulario hoja: header, titleBar, illustration, partsList, colorSpecs, embSpecs, spacer, disclaimer.\n" +
    "Ejemplo (overview de un hoodie): {\"regions\":[{\"type\":\"header\"},{\"type\":\"titleBar\"},{\"type\":\"partsList\"},{\"type\":\"illustration\",\"slots\":2,\"refs\":[\"Frente\",\"Espalda\"],\"briefs\":[{\"garmentPart\":\"Prenda completa\",\"view\":\"Frente plano\",\"mustMark\":[\"bolsillo canguro\",\"cordon y ojales\",\"costura de hombro caido\"],\"measurements\":[{\"label\":\"Largo total desde hombro\",\"perSize\":true}],\"placementLandmark\":\"\",\"factoryNote\":\"Puntadas visibles del canguro: doble aguja\"},{\"garmentPart\":\"Prenda completa\",\"view\":\"Espalda plana\",\"mustMark\":[\"union de capucha\",\"dobladillo\"],\"measurements\":[],\"placementLandmark\":\"\",\"factoryNote\":\"\"}]},{\"type\":\"disclaimer\"}]}\n\n" +
    "Devolve SOLO JSON valido con esta forma exacta, sin markdown:\n" +
    '{"regions":[{"type":"header","weight":10}]}'

  const hybrid = {
    task: HYBRID_TASKS.PAGE_LAYOUT,
    validator: (content) => {
      const value = parseJSONOrRepair(content, "invalid page layout")
      const allowed = new Set(["header", "titleBar", "illustration", "partsList", "colorSpecs", "embSpecs", "note", "spacer", "disclaimer"])
      return Array.isArray(value.regions) && value.regions.length > 0 && value.regions.every((region) => region && allowed.has(region.type))
    },
    fallback: () => JSON.stringify({ regions: deterministicPageLayout(page, context).regions }),
    onStatus,
    signal,
    providers,
  }
  const call = onProgress
    ? deepseekChatStream({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 2500,
        temperature: 0.2,
        ...hybrid,
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
        ...hybrid,
      })

  const parsed = parseJSONOrRepair(await call, "El asistente de IA no devolvio un layout de pagina valido.")
  const regions = Array.isArray(parsed && parsed.regions) ? parsed.regions : []
  const normalized = normalizePlan({ pages: [{ ...page, regions }] }).pages[0]
  // Contract pass: whatever the model proposed, the page leaves here with its
  // purpose's mandatory regions present, forbidden/empty/duplicate ones gone,
  // and chrome in canonical order. The prompt guides; this guarantees.
  return repairPage(normalized, context).page
}
