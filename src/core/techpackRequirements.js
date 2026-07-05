// The shared "tech-pack reasoning core". Given a garment type plus whatever
// data we already have (a seed from a name, a CSV, or a vision extraction),
// this figures out what a real factory tech pack for THAT garment needs,
// what's already known, what's obvious/standard (dumb to ask), and what's
// still missing - so the chat only asks the questions that actually matter,
// one at a time, with numbered options.
//
// Design note (computational model): analyzeRequirements() makes ONE DeepSeek
// call up front to produce the whole field list with options. The client then
// WALKS that list locally (pendingFields/applyAnswer/isComplete) instead of
// hitting DeepSeek every turn - bounded, predictable, and cheap at runtime no
// matter how long the conversation gets.

import { deepseekChat, deepseekChatStream, DeepSeekError } from "./deepseekClient.js"
import { repairTruncatedJSON } from "./jsonSalvage.js"

// Shared by the three DeepSeek calls below: a response cut off by the token
// cap (finish_reason: "length") still carries real, mostly-complete JSON -
// try to salvage it before giving up, so a truncated 9th field doesn't throw
// away the 8 that already generated cleanly.
export function parseJSONOrRepair(raw, errorMessage) {
  const cleaned = raw.replace(/```json|```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {}
  const repaired = repairTruncatedJSON(cleaned)
  if (repaired) {
    try {
      return JSON.parse(repaired)
    } catch {}
  }
  throw new DeepSeekError(errorMessage, { raw })
}

// Rough calibration for the progress estimate below: a typical analysis
// completion runs ~600-700 tokens against the 3000-token cap, and NVIDIA
// batches several tokens per SSE event - observed live around ~50-70 events
// for a full run. Not exact (event count != token count), just a live signal
// for a progress bar, same spirit as the retry-delay constants in
// deepseekClient.js.
const ESTIMATED_EVENT_BUDGET = 60

// Only trusts a field's "label" once its whole object has closed - anchored
// on "why" because it's the LAST key in this prompt's fixed field shape (see
// the JSON template below), so seeing it means the field just finished
// generating, never a label caught mid-write.
export function extractLastCompletedLabel(text) {
  const re = /"label"\s*:\s*"([^"]+)"[^{}]*"why"\s*:\s*"[^"]*"\s*\}/g
  let match
  let last = null
  while ((match = re.exec(text))) last = match[1]
  return last
}

// A field's status:
// - "known"   : value came from the seed (CSV/vision/earlier answer) - don't ask
// - "assumed" : standard/obvious for this garment - pre-filled, don't ask
// - "ask"     : genuinely needs the user - present as a question with options
export const FIELD_STATUS = { KNOWN: "known", ASSUMED: "assumed", ASK: "ask" }

/**
 * One DeepSeek call: reason like a textile technician about what a tech pack
 * for `garmentType` needs, fold in the `seed` we already have, and return the
 * full field list. Throws DeepSeekError on an unusable response (no silent
 * fallback - without requirements there's nothing to walk).
 *
 * @returns {{garmentType: string, fields: Array<{
 *   key: string, label: string, category: "general"|"design",
 *   status: "known"|"assumed"|"ask", value?: string,
 *   options?: string[], why?: string }>}}
 */
export async function analyzeRequirements({ garmentType, seed, tecs, lang = "ES", onProgress }) {
  const seedText = seed && Object.keys(seed).length > 0 ? JSON.stringify(seed) : "(sin datos previos)"
  const instructions =
    "Sos un tecnico textil experto armando la ficha tecnica de una prenda tipo '" + garmentType + "'. " +
    "Pensa como ingeniero de produccion: que datos necesita SI o SI una fabrica para producir bien esta prenda. " +
    "Razona en tres grupos:\n" +
    "1) Lo que ya es ESTANDAR u OBVIO para este tipo de prenda (una fabrica ya lo sabe, seria tonto preguntarlo) -> status \"assumed\", con un value por defecto razonable.\n" +
    "2) Lo que YA sabemos por los datos previos -> status \"known\", con ese value.\n" +
    "3) Lo que realmente hay que PREGUNTAR porque define el producto y no se puede asumir -> status \"ask\".\n\n" +
    "Datos previos que ya tenemos: " + seedText + ".\n" +
    "Tecnicas de aplicacion validas (por si aplican): " + (tecs || []).join(", ") + ".\n\n" +
    "Para cada campo 'ask', incluye 'options': entre 2 y 4 etiquetas CORTAS (2-4 palabras cada una) " +
    "(el usuario podra elegir una numerada o escribir la suya). Para 'assumed'/'known' no hacen falta options.\n" +
    "Enfocate en campos de construccion GENERAL de la prenda (tela, cuello, manga, cierre, bajo, forro, etc.), NO en " +
    "disenos/estampados/bordados todavia - eso se define despues.\n\n" +
    "IMPORTANTE - se conciso para que quepa la respuesta: devolve solo los 6 a 10 campos MAS decisivos (no todos los " +
    "imaginables), 'why' de maximo 10 palabras, y usa la categoria \"general\" para todos los campos de construccion. " +
    "El campo 'category' solo puede ser \"general\" o \"design\".\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"garmentType": "' + garmentType + '", "fields": [' +
    '{"key": "identificadorEnIngles", "label": "Etiqueta en espanol", "category": "general", ' +
    '"status": "ask", "value": "", "options": ["Opcion A", "Opcion B"], "why": "por que importa (breve)"}]}'

  const raw = onProgress
    ? await deepseekChatStream({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        onEvent: ({ contentSoFar, tokensSoFar }) => {
          onProgress({
            percent: Math.min(100, Math.round((tokensSoFar / ESTIMATED_EVENT_BUDGET) * 100)),
            lastLabel: extractLastCompletedLabel(contentSoFar),
          })
        },
      })
    : await deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
      })
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio un analisis de requisitos valido.")
  return normalizeRequirements(parsed, garmentType)
}

// Defensive shaping so the walker helpers can trust the structure regardless
// of small model deviations (missing arrays, bad status strings, etc.).
const DESIGN_FIELD_KINDS = new Set(["name", "position", "technique", "driveLink", "detail"])

export function normalizeRequirements(parsed, garmentType) {
  const validStatus = new Set([FIELD_STATUS.KNOWN, FIELD_STATUS.ASSUMED, FIELD_STATUS.ASK])
  const rawFields = parsed && Array.isArray(parsed.fields) ? parsed.fields : []
  const fields = rawFields
    .filter((f) => f && typeof f.key === "string" && f.key.trim())
    .map((f) => {
      const base = {
        key: f.key.trim(),
        label: typeof f.label === "string" && f.label.trim() ? f.label.trim() : f.key.trim(),
        category: f.category === "design" ? "design" : "general",
        status: validStatus.has(f.status) ? f.status : FIELD_STATUS.ASK,
        value: typeof f.value === "string" ? f.value : "",
        options: Array.isArray(f.options) ? f.options.filter((o) => typeof o === "string" && o.trim()) : [],
        why: typeof f.why === "string" ? f.why : "",
      }
      if (f.optional === true) base.optional = true
      // designSlot/designField only ever come from analyzeDesignExpression()'s
      // "design" category fields - added conditionally so analyzeRequirements()'s
      // plain general fields keep their exact original shape (no stray keys).
      if (typeof f.designSlot === "string" && f.designSlot.trim()) base.designSlot = f.designSlot.trim()
      if (DESIGN_FIELD_KINDS.has(f.designField)) base.designField = f.designField
      return base
    })
  return { garmentType: (parsed && parsed.garmentType) || garmentType, fields }
}

// ── Pure walker helpers (no DeepSeek). Delegated spec, see techpackRequirements.test.js ──

// The next fields the user still needs to answer, in order. If `category` is
// given, only that category ("general" | "design"); otherwise all categories.
export function pendingFields(reqs, category) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  return fields.filter((f) => f.status === FIELD_STATUS.ASK && (category ? f.category === category : true))
}

// Returns a NEW reqs with field `key` set to `value` and marked "known".
// If `key` isn't a known field, appends it as a custom known field (so a
// free-typed answer to something the model didn't list is never lost).
export function applyAnswer(reqs, key, value) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  let found = false
  const next = fields.map((f) => {
    if (f.key !== key) return f
    found = true
    return { ...f, status: FIELD_STATUS.KNOWN, value: value }
  })
  if (!found) {
    next.push({ key, label: key, category: "general", status: FIELD_STATUS.KNOWN, value: value, options: [], why: "" })
  }
  return { ...reqs, fields: next }
}

export function skipField(reqs, key) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  return {
    ...reqs,
    fields: fields.map((f) => {
      if (!f || f.key !== key) return f
      return { ...f, status: FIELD_STATUS.ASSUMED, value: "" }
    }),
  }
}

// True when nothing in `category` (or overall) still needs asking.
export function isComplete(reqs, category) {
  return pendingFields(reqs, category).length === 0
}

// Bridges the reasoning core to what the rest of the app consumes: turns the
// non-"ask" general fields (known + assumed) into the parts[] shape that
// buildCustomGarment / the Piezas step already use.
export function reqsToParts(reqs) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  return fields
    .filter((f) => f.category === "general" && f.status !== FIELD_STATUS.ASK && String(f.value || "").trim())
    .map((f) => ({ label: f.label, val: f.value }))
}

/**
 * Second DeepSeek call in the design-level pass (F3.2): given the garment
 * type plus the general construction answers already collected, reason like
 * a technical designer about which DISCRETE elements (embroidered logo,
 * printed graphic, woven/printed label, personalized hardware, etc.) need
 * their own dedicated design page - each as a group of 2-4 related fields
 * sharing a `designSlot` id, tagged with `designField` ("name"/"position"/
 * "technique"/"driveLink"/"detail") so reqsToDesigns() below can reassemble
 * them into real design objects. Reuses normalizeRequirements() - same field
 * shape as analyzeRequirements(), just with the two extra design-only keys.
 */
export async function analyzeDesignExpression({ garmentType, generalFields, tecs, lang = "ES", onProgress }) {
  const generalText = generalFields && generalFields.length > 0 ? JSON.stringify(generalFields) : "(sin datos de construccion)"
  const instructions =
    "Sos un disenador tecnico textil experto definiendo las paginas de diseno de una ficha tecnica para una prenda tipo '" + garmentType + "'. " +
    "Ya tenemos definidos los campos de construccion general (tela, cuello, manga, etc.): " + generalText + ". " +
    "Ahora pensa SOLO en elementos DISCRETOS que necesitan su propia pagina de diseno en la ficha tecnica: " +
    "cosas con su propio arte/referencia, un link de Drive, o una especificacion de bordado/estampado/parche/etiqueta/herraje personalizado. " +
    "NO preguntes de nuevo por atributos de construccion planos (esos ya estan).\n\n" +
    "Para cada elemento de diseno, pensalo como un GRUPO de 2 a 4 campos relacionados que juntos describen ESE elemento. " +
    "Todos los campos de un mismo grupo comparten un mismo 'designSlot': un identificador corto, url-safe, en ingles y lowercase (ej: 'logo_pecho', 'botones', 'etiqueta_interior').\n" +
    "Cada campo del grupo debe incluir 'designField', que es uno de exactamente: 'name' (nombre humano del elemento, ej: 'Logo bordado pecho'), " +
    "'position' (donde va en la prenda), 'technique' (tecnica de aplicacion, DEBE ser una de esta lista exacta si aplica: " + (tecs || []).join(", ") + "), " +
    "'driveLink' (URL de Drive si el usuario menciona una - normalmente solo si es plausible que exista, la mayoria de elementos no necesitan este campo), " +
    "o 'detail' (cualquier otro atributo relevante para ese elemento especifico, ej: para botones 'cuantos huecos tiene, que material'). " +
    "Puede haber MULTIPLES campos con 'designField: detail' en un mismo designSlot, pero solo UNO de cada uno de los otros tipos.\n\n" +
    "El 'key' de cada campo debe ser globalmente unico, usando el designSlot como prefijo (ej: 'botones_cantidad', 'logo_pecho_tecnica').\n" +
    "Cada campo sigue la misma forma de siempre: key, label, category (SIEMPRE 'design' para todo lo que emita esta funcion), status, value, options, why.\n" +
    "Para campos 'ask', inclui 'options' con 2 a 4 etiquetas CORTAS.\n\n" +
    "Sub-preguntas condicionales: si el elemento implica detalles tecnicos que cambian produccion, agrega campos 'detail' especificos. " +
    "Ejemplos: capucha de dos caras -> archivo dividido, union y margen de seguridad; cierre personalizado -> troquel vs archivo existente; diseno diferente frente/espalda -> archivo por lado. " +
    "Cuando una sub-pregunta sea util pero no obligatoria, marca optional:true (boolean). Si es necesaria para fabricar bien, optional:false u omitido.\n\n" +
    "IMPORTANTE - se conciso: una prenda tipica tiene 1 a 4 elementos de diseno reales que merecen su propia pagina. " +
    "No inventes elementos que no tengan sentido para esta prenda especifica y los campos generales ya definidos. " +
    "Si realmente no hay nada que necesite pagina de diseno, devolve un array de fields vacio.\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"garmentType": "' + garmentType + '", "fields": [' +
    '{"key": "identificadorUnico", "label": "Etiqueta en espanol", "category": "design", "designSlot": "slot_id", "designField": "name|position|technique|driveLink|detail", ' +
    '"status": "ask", "value": "", "options": ["Opcion A", "Opcion B"], "why": "por que importa (breve)"}]}'

  const raw = onProgress
    ? await deepseekChatStream({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        onEvent: ({ contentSoFar, tokensSoFar }) => {
          onProgress({
            percent: Math.min(100, Math.round((tokensSoFar / ESTIMATED_EVENT_BUDGET) * 100)),
            lastLabel: extractLastCompletedLabel(contentSoFar),
          })
        },
      })
    : await deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
      })
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio un analisis de disenos valido.")
  return normalizeRequirements(parsed, garmentType)
}

// Merges freshly-analyzed design fields into an existing reqs object without
// mutating it - same defensive null-handling style as applyAnswer/pendingFields.
export function mergeDesignFields(reqs, designFields) {
  const base = reqs && Array.isArray(reqs.fields) ? { ...reqs, fields: [...reqs.fields] } : { fields: [] }
  const additions = Array.isArray(designFields) ? designFields : []
  base.fields.push(...additions)
  return base
}

// Bridges the design-level reasoning pass to what mapChatDesignsToDesigns()
// (buildCustomGarment.js) expects: groups known/assumed "design" fields by
// designSlot and reassembles each group into one {name, pos, tec, driveLink,
// posDetail, notes} object - one per design element, in first-appearance order.
export function reqsToDesigns(reqs) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  const designFields = fields.filter(
    (f) => f.category === "design" && f.status !== FIELD_STATUS.ASK && String(f.value || "").trim()
  )
  const slotMap = new Map()
  const slotOrder = []
  for (const f of designFields) {
    const slot = f.designSlot
    if (!slot || typeof slot !== "string" || !slot.trim()) continue
    const df = f.designField
    if (!df || !["name", "position", "technique", "driveLink", "detail"].includes(df)) continue
    if (!slotMap.has(slot)) {
      slotMap.set(slot, { name: "", pos: "", tec: "", driveLink: "", posDetail: "", details: [] })
      slotOrder.push(slot)
    }
    const group = slotMap.get(slot)
    const val = String(f.value || "").trim()
    if (df === "name") group.name = val
    else if (df === "position") group.pos = val
    else if (df === "technique") group.tec = val
    else if (df === "driveLink") group.driveLink = val
    else if (df === "detail") {
      if (!group.posDetail) group.posDetail = val
      group.details.push((f.label || "") + ": " + val)
    }
  }
  return slotOrder.map((slot) => {
    const g = slotMap.get(slot)
    const name = g.name || slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    return {
      name,
      pos: g.pos,
      tec: g.tec,
      driveLink: g.driveLink,
      posDetail: g.posDetail,
      notes: g.details.join(", "),
    }
  })
}

// Third DeepSeek call in the design-level pass (F3.3): once a design element's
// fields are fully answered, ask the model to author a concrete instruction
// - a "brief" - describing exactly what the illustration/artwork for that
// page should show, informed by the real details already collected (not a
// generic placeholder). This is authored text for a human illustrator, never
// a question - no options/status/ask semantics, so it doesn't reuse the
// fields/normalizeRequirements shape at all.
export async function authorIllustrationBriefs({ garmentType, designs, lang = "ES", onProgress }) {
  if (!Array.isArray(designs) || designs.length === 0) return { briefs: [] }

  const designsList = designs
    .map((d, i) => {
      const name = (d && d.name) || "elemento_" + i
      const pos = (d && d.pos) || ""
      const tec = (d && d.tec) || ""
      const posDetail = (d && d.posDetail) || ""
      const notes = (d && d.notes) || ""
      return '- "' + name + '": posicion="' + pos + '", tecnica="' + tec + '", detallePos="' + posDetail + '", notas="' + notes + '"'
    })
    .join("\n")

  const instructions =
    "Sos un tecnico textil experto redactando briefs de ilustracion para fichas tecnicas de una prenda tipo '" + garmentType + "'. " +
    "A continuacion te doy una lista de elementos de diseno YA DEFINIDOS (nombre, posicion, tecnica, detalle de posicion, notas). " +
    "Para CADA elemento, redacta UN brief de ilustracion concreto y especifico de 1 a 3 oraciones en espanol, " +
    "describiendo EXACTAMENTE lo que debe mostrar la ilustracion/arte para la pagina de ficha tecnica de ese elemento. " +
    "El brief debe basarse en los detalles reales proporcionados (materiales, cantidades, colores, dimensiones, ubicacion exacta) " +
    "mencionandolos explicitamente, NO generico. Es un brief PARA un ilustrador/disenador humano, no una pregunta al usuario. " +
    "No incluyas opciones, estados ni semantica de pregunta.\n\n" +
    "Elementos de diseno:\n" + designsList + "\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"briefs": [{"name": "...", "illustrationBrief": "..."}]}'

  const raw = onProgress
    ? await deepseekChatStream({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        onEvent: ({ contentSoFar, tokensSoFar }) => {
          onProgress({
            percent: Math.min(100, Math.round((tokensSoFar / ESTIMATED_EVENT_BUDGET) * 100)),
            lastLabel: extractLastCompletedLabel(contentSoFar),
          })
        },
      })
    : await deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
      })

  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio briefs de ilustracion validos.")
  const briefs = parsed && Array.isArray(parsed.briefs) ? parsed.briefs : []
  return {
    briefs: briefs
      .filter((b) => b && typeof b.name === "string" && b.name.trim())
      .map((b) => ({
        name: b.name.trim(),
        illustrationBrief: typeof b.illustrationBrief === "string" ? b.illustrationBrief : "",
      })),
  }
}

// Pure: attaches each design's matching brief (by exact name) without
// mutating the input array - defaults to "" when nothing matched (a failed/
// skipped brief authoring pass shouldn't block the rest of the draft).
export function attachIllustrationBriefs(designs, briefs) {
  const safeDesigns = Array.isArray(designs) ? designs : []
  const safeBriefs = Array.isArray(briefs) ? briefs : []
  const briefMap = new Map()
  safeBriefs.forEach((b) => {
    if (b && typeof b.name === "string" && b.name) {
      briefMap.set(b.name, typeof b.illustrationBrief === "string" ? b.illustrationBrief : "")
    }
  })
  return safeDesigns.map((d) => ({ ...d, illustrationBrief: briefMap.has(d && d.name) ? briefMap.get(d.name) : "" }))
}
