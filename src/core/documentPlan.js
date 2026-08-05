import { deepseekChat, deepseekChatStream, getTextAIProvider } from "./deepseekClient.js"
import { parseJSONOrRepair } from "./techpackRequirements.js"
import { normalizePlan } from "../pages/interpretPlan.js"
import { repairOutline, repairPage } from "../pages/pageContracts.js"
import { buildSemanticOutline, classifyPartBucket, deterministicPageLayout, partitionPartsBySystem } from "./semanticOutline.js"
import { HYBRID_TASKS } from "./hybridTasks.js"
import { hasEmbSpecs } from "./helpers.js"

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

function activeParts(parts) {
  return (Array.isArray(parts) ? parts : []).filter((part) => part && part.on !== false && part.id != null)
}

function validSectionPurpose(purpose) {
  return purpose === "overview" || purpose === "lining" || purpose === "label" ||
    (typeof purpose === "string" && (purpose.startsWith("structure:") || purpose.startsWith("data:")))
}

function normalizeSections(raw) {
  const source = raw && Array.isArray(raw.sections) ? raw.sections : raw && Array.isArray(raw.pages) ? raw.pages : []
  const seen = new Set()
  return source.flatMap((section, index) => {
    if (!section || typeof section !== "object") return []
    const purpose = safeString(section.purpose, "")
    if (!validSectionPurpose(purpose)) return []
    const id = slug(section.id || purpose, "section-" + (index + 1))
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      title: safeString(section.title, "Seccion " + (index + 1)),
      purpose,
      objective: safeString(section.objective, "Organizar datos tecnicos relacionados."),
      criteria: safeString(section.criteria, "Datos que sirven al objetivo de esta seccion."),
      views: Array.isArray(section.views) ? section.views.filter((view) => typeof view === "string" && view.trim()) : [],
      illustration: safeString(section.illustration, "") || undefined,
    }]
  })
}

function deterministicSections(context) {
  return fallbackOutline(context).pages
    .filter((page) => validSectionPurpose(page.purpose))
    .map((page) => ({
      id: page.id,
      title: page.title,
      purpose: page.purpose,
      objective: page.objective || "Organizar datos tecnicos relacionados.",
      criteria: page.criteria || "Datos que sirven al objetivo de esta seccion.",
      views: page.views || [],
      illustration: page.illustration,
    }))
}

function assignmentPieceId(item) {
  if (!item || typeof item !== "object") return ""
  return safeString(item.pieza != null ? String(item.pieza) : item.piece != null ? String(item.piece) : item.partId != null ? String(item.partId) : item.id != null ? String(item.id) : "", "")
}

function assignmentSectionId(item) {
  return safeString(item && (item.seccion != null ? item.seccion : item.section), "")
}

function normalizeAssignments(raw) {
  const source = raw && Array.isArray(raw.asignaciones) ? raw.asignaciones : raw && Array.isArray(raw.assignments) ? raw.assignments : []
  return source.map((item) => ({ piece: assignmentPieceId(item), section: assignmentSectionId(item) }))
}

function exactAssignmentCoverage(assignments, parts, sectionIds) {
  const expected = activeParts(parts).map((part) => String(part.id))
  if (assignments.length !== expected.length) return false
  const received = assignments.map((item) => item.piece)
  if (new Set(received).size !== received.length || received.some((id) => !expected.includes(id))) return false
  if (!expected.every((id) => received.includes(id))) return false
  return assignments.every((item) => !item.section || sectionIds.has(item.section))
}

function deterministicAssignment(part, sections) {
  const classification = classifyPartBucket(part)
  const direct = sections.find((section) => section.id === classification.bucket || section.purpose === classification.purpose)
  return { piece: String(part.id), section: direct ? direct.id : "" }
}

export function composeOutlineFromSections(sectionsInput, assignmentsInput, context = {}) {
  const sections = normalizeSections({ sections: sectionsInput })
  const parts = activeParts(context.parts)
  const partById = new Map(parts.map((part) => [String(part.id), part]))
  const sectionById = new Map(sections.map((section) => [section.id, section]))
  const groups = new Map(sections.map((section) => [section.id, []]))
  const changes = []

  function deterministicTarget(part) {
    const fallbackPage = partitionPartsBySystem([part], { maxPartsPerPage: 8 })[0]
    const fallbackId = fallbackPage ? fallbackPage.id.replace(/-(?:\d+)$/, "") : "data-general"
    let target = sections.find((section) => section.purpose === (fallbackPage && fallbackPage.purpose))
    if (!target) {
      target = {
        id: fallbackId,
        title: fallbackPage ? fallbackPage.title : "Datos generales",
        purpose: fallbackPage ? fallbackPage.purpose : "data:general",
        objective: fallbackPage && fallbackPage.objective || "Reunir datos sin una seccion especifica.",
        criteria: fallbackPage && fallbackPage.criteria || "Datos no cubiertos por otra seccion.",
        views: fallbackPage && fallbackPage.views || [],
        illustration: fallbackPage && fallbackPage.illustration,
      }
      sections.push(target)
      sectionById.set(target.id, target)
      groups.set(target.id, [])
      changes.push("created " + target.purpose + " for piece " + part.id)
    }
    return target
  }

  for (const assignment of normalizeAssignments({ asignaciones: assignmentsInput })) {
    const part = partById.get(assignment.piece)
    if (!part) continue
    let target = sectionById.get(assignment.section)
    if (!target) {
      target = deterministicTarget(part)
      changes.push("assigned " + assignment.piece + " by deterministic contract")
    }
    groups.get(target.id).push(part)
    partById.delete(assignment.piece)
  }

  for (const part of partById.values()) {
    const preferred = deterministicAssignment(part, sections)
    const target = sectionById.get(preferred.section) || deterministicTarget(part)
    groups.get(target.id).push(part)
    changes.push("restored missing piece " + part.id + " by deterministic contract")
  }

  const pages = [{ id: "cover", title: safeString(context.garmentType, "Illustration Handoff"), purpose: "cover" }]
  for (const section of sections) {
    const members = groups.get(section.id) || []
    if (!members.length) {
      if (parts.length === 0 && section.purpose === "overview") pages.push({ ...section, pieces: undefined })
      continue
    }
    const chunks = []
    for (let index = 0; index < members.length; index += 8) chunks.push(members.slice(index, index + 8))
    chunks.forEach((chunk, index) => pages.push({
      ...section,
      id: section.id + (chunks.length > 1 ? "-" + (index + 1) : ""),
      title: section.title + (chunks.length > 1 ? " · " + (index + 1) + "/" + chunks.length : ""),
      pieces: chunk.map((part) => String(part.id)),
    }))
  }
  const designOnly = buildSemanticOutline({ garmentType: context.garmentType, parts: [], designs: context.designs }).pages
    .filter((page) => typeof page.purpose === "string" && page.purpose.startsWith("design:"))
  pages.push(...designOnly)
  return { outline: { pages }, changes }
}

export function extractLastCompletedRegionType(text) {
  const re = /"type"\s*:\s*"([^"]+)"/g
  let match
  let last = null
  while ((match = re.exec(text))) last = match[1]
  return last
}

// A design object carries the uploaded artwork as a base64 `imageData` blob
// (plus imgNatW/H) - hundreds of KB per design. JSON.stringify'ing the raw
// design into a TEXT prompt shipped that blob to the model, which (a) blew
// the studio bridge's 120000-char per-message cap outright - observed live
// as a 413 that failed the whole document plan - and (b) even when it fit,
// buried the handful of facts the planner actually reasons about under a
// wall of base64 it can do nothing with. Layout planning needs the design's
// IDENTITY and SPECS, never its pixels.
function promptSafeDesigns(designs) {
  return (Array.isArray(designs) ? designs : []).map((design) => {
    const safe = {
      name: design && design.name,
      pos: design && design.pos,
      posDetail: design && design.posDetail,
      tec: design && design.tec,
    }
    if (design && design.w) safe.w = design.w
    if (design && design.h) safe.h = design.h
    if (design && design.unit) safe.unit = design.unit
    // Counts, not contents: the planner decides whether a page needs a
    // colorSpecs/embSpecs block, which depends on WHETHER data exists and
    // roughly how much - never on each hex or stop row.
    if (design && Array.isArray(design.colors) && design.colors.length) safe.colorCount = design.colors.length
    if (design && hasEmbSpecs(design.emb)) safe.hasEmbroiderySheet = true
    if (design && design.imageData) safe.hasArtwork = true
    return safe
  })
}

// Same discipline for parts: only the fields the planner groups/paginates by.
// `label` (see semanticOutline.js's withPartLabels) is what lets the model
// tell "Gramaje" from "Rango de tallas" instead of guessing from a bare
// value like "180-220 GSM" - without it the planner is reasoning half-blind.
function promptSafeParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .filter((part) => part && part.on !== false)
    .map((part) => ({ id: part.id, val: part.val, ...(part.label ? { label: part.label } : {}), ...(part.system ? { system: part.system } : {}) }))
}

export async function planDocumentSections(context, { onStatus, signal, providers } = {}) {
  const parts = activeParts(context && context.parts)
  const minimumSections = Math.min(6, Math.max(1, parts.length))
  const labelsOnly = parts.map((part) => ({ id: String(part.id), label: safeString(part.label || part.customName, "Pieza " + part.id) }))
  const fallback = deterministicSections(context)
  const fallbackPurposes = new Set(fallback.map((section) => section.purpose))
  const padding = [
    ["materials", "Materiales y consumos", "data:materials"],
    ["measurements", "Medidas y tolerancias", "data:measurements"],
    ["stitching", "Costuras y puntadas", "data:stitching"],
    ["quality", "Control de calidad", "data:quality"],
    ["labels-packaging", "Etiquetas y empaque", "data:labels-packaging"],
    ["general", "Datos generales", "data:general"],
  ]
  for (const [id, title, purpose] of padding) {
    if (fallback.length >= minimumSections) break
    if (fallbackPurposes.has(purpose)) continue
    fallback.push({ id, title, purpose, objective: "Organizar " + title.toLowerCase() + ".", criteria: "Datos confirmados que pertenecen a " + title.toLowerCase() + ".", views: [] })
    fallbackPurposes.add(purpose)
  }
  const instructions =
    "Sos arquitecto de informacion de fichas tecnicas textiles. Decidi el INDICE PRODUCTIVO de este documento, no distribuyas piezas todavia. " +
    "Cada seccion debe tener una mision diferente para fabrica y un criterio que otro ingeniero pueda aplicar sin adivinar. " +
    "Usa entre " + minimumSections + " y 14 secciones cuando el volumen lo permita. No incluyas portada, indice ni paginas de diseno: el contrato las agrega. " +
    "Usa purpose structure:<slug> para sistemas que necesitan ilustracion, o data:<slug> para tablas/notas sin ilustracion obligatoria. " +
    "La lista es vocabulario abierto: crea una seccion especifica si la prenda lo exige. No inventes datos ni agrupes todo como cuerpo exterior.\n\n" +
    "Prenda: " + safeString(context && context.garmentType, "custom") + "\n" +
    "Campos disponibles (solo nombres, sin valores): " + JSON.stringify(labelsOnly) + "\n" +
    "Idioma: " + safeString(context && context.lang, "ES") + "\n\n" +
    'Devolve SOLO JSON: {"sections":[{"id":"materiales","title":"Materiales y consumos","purpose":"data:materials","objective":"...","criteria":"...","views":[]}]}'

  let aiResult = null
  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    task: HYBRID_TASKS.OUTLINE_INDEX,
    maxTokens: 2000,
    temperature: 0.1,
    validator: (content) => {
      const sections = normalizeSections(parseJSONOrRepair(content, "invalid section index"))
      return sections.length >= minimumSections && sections.length <= 14 &&
        sections.every((section) => section.title && section.objective && section.criteria && validSectionPurpose(section.purpose))
    },
    fallback: JSON.stringify({ sections: fallback }),
    onStatus,
    signal,
    providers,
    onResult: (result) => { aiResult = result },
  })
  return { raw, sections: normalizeSections(parseJSONOrRepair(raw, "El modelo no devolvio un indice valido.")), aiResult }
}

export async function assignPartsToSections(sections, context, { onStatus, onBatch, signal, providers, batchSize = 12 } = {}) {
  const ordered = activeParts(context && context.parts).slice().sort((a, b) => {
    const left = classifyPartBucket(a).purpose
    const right = classifyPartBucket(b).purpose
    return left.localeCompare(right) || String(a.id).localeCompare(String(b.id))
  })
  const batches = []
  for (let index = 0; index < ordered.length; index += batchSize) batches.push(ordered.slice(index, index + batchSize))
  const sectionIds = new Set(sections.map((section) => section.id))
  const assignments = []
  const results = []

  if (ordered.length === 0) return { assignments, results }

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    if (typeof onBatch === "function") onBatch({ index: index + 1, total: batches.length, size: batch.length })
    const prompt =
      "Sos ingeniero textil. Asigna CADA dato del lote a la seccion cuyo criterio realmente cumple. No omitas, dupliques ni inventes ids. " +
      "Si ninguna seccion aplica honestamente, usa seccion vacia; el contrato lo ubicara despues.\n\n" +
      "Secciones: " + JSON.stringify(sections.map(({ id, title, purpose, objective, criteria }) => ({ id, title, purpose, objective, criteria }))) + "\n" +
      "Lote: " + JSON.stringify(promptSafeParts(batch)) + "\n\n" +
      'Devolve SOLO JSON: {"asignaciones":[{"pieza":"12","seccion":"materiales"}]}'
    const deterministic = batch.map((part) => deterministicAssignment(part, sections))
      .map((item) => ({ pieza: item.piece, seccion: item.section }))
    let aiResult = null
    const raw = await deepseekChat({
      messages: [{ role: "user", content: prompt }],
      task: HYBRID_TASKS.OUTLINE_ASSIGN,
      maxTokens: 1200,
      temperature: 0,
      validator: (content) => exactAssignmentCoverage(normalizeAssignments(parseJSONOrRepair(content, "invalid assignments")), batch, sectionIds),
      fallback: JSON.stringify({ asignaciones: deterministic }),
      onStatus,
      signal,
      providers,
      operationId: "outline-assign-" + (index + 1),
      onResult: (result) => { aiResult = result },
    })
    const accepted = normalizeAssignments(parseJSONOrRepair(raw, "El modelo no devolvio asignaciones validas."))
    assignments.push(...accepted)
    results.push({ batch: index + 1, raw, aiResult })
  }
  return { assignments, results }
}

export async function planDocumentOutline({ garmentType, parts, designs, brief, lang = "ES" }, { onProposal, onStatus, onSections, onBatch, signal, providers } = {}) {
  const context = { garmentType, parts, designs, brief, lang, providers }
  const sectionResult = await planDocumentSections(context, { onStatus, signal, providers })
  if (typeof onSections === "function") onSections(sectionResult.sections)
  const assignmentResult = await assignPartsToSections(sectionResult.sections, context, { onStatus, onBatch, signal, providers })
  const composed = composeOutlineFromSections(sectionResult.sections, assignmentResult.assignments, context)
  const repaired = repairOutline(composed.outline, context)
  const repairs = [...composed.changes, ...repaired.repairs]
  const degraded = sectionResult.aiResult && sectionResult.aiResult.provider === "contract" ||
    assignmentResult.results.some((result) => result.aiResult && result.aiResult.provider === "contract")
  const aiResult = degraded
    ? { provider: "contract", model: "deterministic", degraded: true, fallbackReason: "one_or_more_planning_stages_used_contract" }
    : sectionResult.aiResult
  if (typeof onProposal === "function") onProposal({
    raw: sectionResult.raw,
    parsed: { sections: sectionResult.sections },
    proposed: composed.outline,
    sections: sectionResult.sections,
    assignments: assignmentResult.assignments,
    batches: assignmentResult.results,
    refinements: [],
    outline: repaired.outline,
    repairs,
    aiResult,
  })
  return repaired.outline
}

export async function planPageLayout(pageOutline, context, { onProgress, onStatus, signal, providers, onResult } = {}) {
  const page = pageOutline && typeof pageOutline === "object" ? pageOutline : {}
  const instructions =
    "Sos disenador de layout para fichas tecnicas textiles. Para ESTA pagina, repartí el espacio por jerarquia visual usando solamente este vocabulario cerrado de bloques hoja: " +
    "header, titleBar, illustration, partsList, colorSpecs, embSpecs, note, spacer, disclaimer.\n\n" +
    "Pagina: " + JSON.stringify(page) + "\n" +
    // Same base64/bulk stripping as planDocumentOutline - see promptSafeDesigns.
    // This path runs ONCE PER PAGE, so an unstripped design blob multiplied the
    // waste (and the 413 risk) by the page count.
    "Contexto: " + JSON.stringify({
      garmentType: context && context.garmentType,
      parts: promptSafeParts(context && context.parts),
      designs: promptSafeDesigns(context && context.designs),
      brief: context && context.brief,
      lang: context && context.lang,
    }) + "\n\n" +
    "Esta pagina existe para: " + safeString(page.objective, "comunicar su contenido tecnico sin ambiguedad") + ". " +
    "Su criterio de inclusion es: " + safeString(page.criteria, "solo datos que sirven a ese objetivo") + ". " +
    "Todo bloque y toda vista que propongas debe servir directamente a esa mision.\n\n" +
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
    // Surfaces which provider actually answered (or "contract" when every
    // provider failed and the deterministic fallback shipped instead) plus
    // WHY, via runHybridAI's already-computed fallbackReason - previously
    // discarded here, so a page could render 100% deterministic with zero
    // visible warning. See App.jsx's buildCustomDocumentPages.
    onResult,
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
