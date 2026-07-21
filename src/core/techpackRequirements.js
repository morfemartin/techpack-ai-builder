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
import { HYBRID_TASKS } from "./hybridTasks.js"
import { repairTruncatedJSON } from "./jsonSalvage.js"
import { buildLayeredRequirements, enrichLayersWithModel, mergeAdditionalGeneralAsk } from "./requirementLayers.js"

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

export function extractCompletedLabels(text) {
  const labels = []
  const seen = new Set()
  const re = /"label"\s*:\s*"([^"]+)"[^{}]*"why"\s*:\s*"[^"]*"\s*\}/g
  let match
  while ((match = re.exec(String(text || "")))) {
    if (!seen.has(match[1])) {
      seen.add(match[1])
      labels.push(match[1])
    }
  }
  return labels
}

function streamProgress(contentSoFar, tokensSoFar, provider) {
  const completedLabels = extractCompletedLabels(contentSoFar)
  return { tokensSoFar, provider, completedLabels, lastLabel: completedLabels[completedLabels.length - 1] || null }
}

// A field's status:
// - "known"   : value came from the seed (CSV/vision/earlier answer) - don't ask
// - "assumed" : standard/obvious for this garment - pre-filled, don't ask
// - "ask"     : genuinely needs the user - present as a question with options
export const FIELD_STATUS = { KNOWN: "known", ASSUMED: "assumed", ASK: "ask" }

/**
 * One DeepSeek call: reason like a textile technician about what a tech pack
 * for `garmentType` needs and enrich the evidence we already have. The final
 * field list is NOT model-owned: the deterministic layer contract below
 * decides every factory-critical question, so a weak or unavailable model
 * cannot omit a whole production layer.
 *
 * @returns {{garmentType: string, fields: Array<{
 *   key: string, label: string, category: "general"|"design",
 *   status: "known"|"assumed"|"ask", value?: string,
 *   options?: string[], why?: string }>}}
 */
export async function analyzeRequirements({ garmentType, seed, tecs, lang = "ES", onProgress, onStatus, signal }) {
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
    "REGLA CLAVE - las options tienen que ser propias de ESTE tipo de prenda, no de ropa en general: nombra materiales, " +
    "construcciones y avios que se usan REALMENTE en una '" + garmentType + "'. Ejemplo de lo que NO sirve: ofrecer " +
    "'Algodon pique / Jersey' como tela de una campera impermeable, o 'Cuello polo' en un pantalon. Si una pregunta no " +
    "admite opciones especificas de esta prenda, es señal de que no vale la pena preguntarla.\n" +
    "Cubri la construccion GENERAL de la prenda (tela, cuello, manga, cierre, bajo, forro, etc.), NO disenos/" +
    "estampados/bordados todavia - eso se define despues. Incluí TAMBIEN, con opciones propias de esta prenda, el uso " +
    "principal, el calce/silueta y el rango de talles: para una campera de montana el uso son opciones como " +
    "'Montanismo tecnico' o 'Trekking', no 'Casual / Uniforme'. Si dejas esas tres genericas, la ficha se siente de " +
    "catalogo y no de esta prenda.\n\n" +
    "COBERTURA: devolve entre 8 y 14 campos, cubriendo todas las areas de construccion que esta prenda realmente tiene " +
    "(no inventes areas que no aplican: una remera no lleva capucha). Marca como 'assumed' lo que para esta prenda es " +
    "estandar de fabrica, asi no se lo preguntamos al cliente al pedo. 'why' de maximo 10 palabras. Usa la categoria " +
    "\"general\" para todos los campos de construccion; 'category' solo puede ser \"general\" o \"design\".\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"garmentType": "' + garmentType + '", "fields": [' +
    '{"key": "identificadorEnIngles", "label": "Etiqueta en espanol", "category": "general", ' +
    '"status": "ask", "value": "", "options": ["Opcion A", "Opcion B"], "why": "por que importa (breve)"}]}'

  const hybrid = {
    task: HYBRID_TASKS.INTAKE,
    // The questionnaire is the model's own reasoning about THIS garment - the
    // fixed layer template is no longer folded in on top of it. That template
    // assumes a torso garment, so it asked a pair of socks about its collar,
    // sleeve and chest pocket: incoherent questions dressed up as coverage.
    //
    // With no template underneath, this validator is what guarantees quality:
    // a thin or malformed answer is REJECTED (the other provider then tries,
    // and if nobody can answer the call fails loudly) instead of being quietly
    // padded out. Rejections are tagged contractViolation upstream, so they
    // never count against the provider's circuit breaker.
    validator: (content) => {
      const value = normalizeRequirements(parseJSONOrRepair(content, "invalid intake"), garmentType)
      const general = value.fields.filter((field) => field.category === "general")
      const asked = general.filter((field) => field.status === FIELD_STATUS.ASK)
      return (
        new Set(value.fields.map((field) => field.key)).size === value.fields.length &&
        // enough substance to actually build a tech pack from
        asked.length >= 6 &&
        // every question the user will see must offer numbered choices
        asked.every((field) => field.options.length >= 2 && field.options.length <= 4)
      )
    },
    // Deliberately no `fallback`: if neither provider can reason about this
    // garment, runHybridAI throws and the caller surfaces a real failure. A
    // generic questionnaire here would look like success and quietly poison
    // the tech pack with questions that do not belong to this garment.
    onStatus,
    signal,
  }
  const raw = onProgress
    ? await deepseekChatStream({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        ...hybrid,
        onEvent: ({ contentSoFar, tokensSoFar, provider }) => onProgress(streamProgress(contentSoFar, tokensSoFar, provider)),
      })
    : await deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        ...hybrid,
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
      if (typeof f.layer === "string" && f.layer.trim()) base.layer = f.layer.trim()
      if (typeof f.example === "string" && f.example.trim()) base.example = f.example.trim()
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

function hasGeneralAsk(fields) {
  return fields.some((f) => f && f.category === "general" && f.status === FIELD_STATUS.ASK)
}

function fallbackGeneralQuestions(garmentType = "") {
  const garment = String(garmentType || "").toLowerCase()
  if (/hoodie|sudadera|buzo|capucha/.test(garment)) {
    return [
      {
        key: "fabric",
        label: "Tela principal",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Felpa 300-350 g/m2", "French terry", "Fleece pesado", "Algodon premium"],
        why: "define tacto, caida y costo",
      },
      {
        key: "fit",
        label: "Fit / silueta",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Regular", "Oversized", "Relaxed", "Boxy"],
        why: "define patronaje y medidas",
      },
      {
        key: "hood",
        label: "Capucha",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Doble tela", "Forrada", "Con cordon", "Sin cordon"],
        why: "define consumo y acabado",
      },
      {
        key: "pocket",
        label: "Bolsillo",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Canguro", "Sin bolsillo", "Laterales", "Cremallera"],
        why: "cambia piezas frontales",
      },
      {
        key: "cuffs_hem",
        label: "Punos y bajo",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Rib 2x2", "Rib 1x1", "Misma tela", "Elastico oculto"],
        why: "define terminaciones",
      },
      {
        key: "closure",
        label: "Cierre",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Pullover", "Zipper completo", "Medio zipper", "Broches"],
        why: "define avios y proceso",
      },
    ]
  }
  if (/polo/.test(garment)) {
    return [
      {
        key: "fabric",
        label: "Tela principal",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Algodon pique", "Jersey algodon", "Performance stretch", "Mezcla CVC"],
        why: "define tacto, caida y costo",
      },
      {
        key: "fit",
        label: "Fit / silueta",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Regular", "Slim", "Relaxed", "Golf fit"],
        why: "define patronaje y medidas",
      },
      {
        key: "collar",
        label: "Cuello",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Rib tejido", "Auto tela", "Cuello polo plano", "Especial"],
        why: "cambia construccion superior",
      },
      {
        key: "sleeve",
        label: "Manga",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Corta con rib", "Corta dobladillo", "Larga", "Raglan"],
        why: "define piezas y consumo",
      },
      {
        key: "placket",
        label: "Tapeta",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["2 botones", "3 botones", "Sin botones", "Zipper corto"],
        why: "define avios frontales",
      },
      {
        key: "hem_finish",
        label: "Terminacion bajo",
        category: "general",
        status: FIELD_STATUS.ASK,
        value: "",
        options: ["Bajo recto", "Bajo curvo", "Aberturas laterales", "Rib inferior"],
        why: "define acabado final",
      },
    ]
  }
  return [
    {
      key: "fabric",
      label: "Tela principal",
      category: "general",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Algodon pique", "Jersey algodon", "Performance stretch", "Mezcla CVC"],
      why: "define tacto, caida y costo",
    },
    {
      key: "fit",
      label: "Fit / silueta",
      category: "general",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Regular", "Slim", "Oversized", "Relaxed"],
      why: "define patronaje y medidas",
    },
    {
      key: "collar",
      label: "Cuello",
      category: "general",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Rib tejido", "Cuello plano", "Sin cuello", "Especial"],
      why: "cambia construccion superior",
    },
    {
      key: "sleeve",
      label: "Manga",
      category: "general",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Corta", "Larga", "Raglan", "Sin manga"],
      why: "define piezas y consumo",
    },
    {
      key: "closure",
      label: "Cierre / botonadura",
      category: "general",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Tapeta 2 botones", "Tapeta 3 botones", "Cierre zipper", "Sin cierre"],
      why: "define avios y proceso",
    },
    {
      key: "hem_finish",
      label: "Terminacion bajo",
      category: "general",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Dobladillo simple", "Rib inferior", "Bajo recto", "Bajo curvo"],
      why: "define acabado final",
    },
  ]
}

// The model can occasionally be overconfident for broad garment names ("polo")
// and mark every construction field assumed. For a brand-new typed garment
// with no seed facts, that breaks the core UX: the chat should present
// numbered technical questions, not jump straight to the final catch-all.
export function ensureMinimumGeneralQuestions(reqs, seed) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  const garmentType = (reqs && reqs.garmentType) || "Prenda"
  const generalFields = fields.filter((field) => field && field.category === "general")
  const designFields = fields.filter((field) => field && field.category === "design")

  // The external model may advise on wording, but it is never authoritative
  // about COVERAGE. Only source evidence (vision, CSV, user-provided seed, or
  // the model's own KNOWN/ASSUMED facts) can prefill a contractual question -
  // this prevents a confident weak model from silently marking a vital
  // construction decision as "assumed" instead of asking it.
  const layered = buildLayeredRequirements({ garmentType, seed, modelFields: generalFields })

  // Coverage is settled above; depth happens in the two steps below.
  //
  // 1) TAILOR the layers themselves. A fixed template cannot know that a
  //    shell jacket and a cotton polo need different answers to "Tela
  //    principal", so where the model reasoned about the same datum, the
  //    layer borrows its garment-specific options/wording. Without this the
  //    model's better version was dropped by the dedupe below and every
  //    garment read like the same generic checklist.
  const { fields: tailored, consumedKeys } = enrichLayersWithModel({ garmentType, layeredFields: layered.fields, modelFields: generalFields })

  // 2) ADD what the template could not anticipate at all (a particular trim,
  //    a construction variant). Anything already consumed as a layer tailor
  //    is excluded so the same datum is never asked twice.
  const remainingModelFields = generalFields.filter((field) => !consumedKeys.has(field.key))
  const extra = mergeAdditionalGeneralAsk({ garmentType, layeredFields: tailored, modelFields: remainingModelFields })

  return { ...reqs, garmentType: layered.garmentType, fields: [...tailored, ...extra, ...designFields] }
}

export function fallbackRequirements(garmentType, seed) {
  return ensureMinimumGeneralQuestions(normalizeRequirements({ garmentType, fields: [] }, garmentType), seed)
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

// Undoes an answer: puts `key` back to "ask" with an empty value, so it's
// pending again. Safe by construction - pendingFields() always filters
// reqs.fields in its ORIGINAL array order, and fields only ever move forward
// (ask -> known/assumed) except through this function, so reverting the most
// recently answered field is guaranteed to make it the next one askNext()
// lands on (never a different field, never a stale re-render).
export function revertField(reqs, key) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  return {
    ...reqs,
    fields: fields.map((f) => {
      if (!f || f.key !== key) return f
      return { ...f, status: FIELD_STATUS.ASK, value: "" }
    }),
  }
}

export function looksLikeQuestion(text) {
  const normalized = String(text || "").trim().toLowerCase()
  if (!normalized) return false
  if (/[?¿]/.test(normalized)) return true
  return /^(que|qué|como|cómo|cual|cuál|cuanto|cuánto|donde|dónde|cuando|cuándo|quien|quién|por que|por qué|para que|para qué)\b/.test(normalized)
    || /\b(que es|qué es|no entiendo|explica(?:me)?|a que te refieres|a qué te refieres|dame un ejemplo|por que importa|por qué importa|what is|i don't understand|explain)\b/.test(normalized)
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

// Deterministic safety net for the design pass. The AI can discover nuanced
// applications, but if it is down or returns an empty list we still collect
// the minimum information a factory and illustrator need after the user said
// that the garment has an application.
export function fallbackDesignFields(reqs) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  const applications = fields.find((field) => field && field.key === "applications")
  const value = String(applications && applications.value || "").toLowerCase()
  if (!value || /sin\s+(aplicacion|aplicación|diseno|diseño|logo|arte)|ningun|ningún|no tiene/.test(value)) return []
  return [
    {
      key: "application_name",
      label: "Que aplicacion es",
      category: "design",
      designSlot: "application_1",
      designField: "name",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Logo de marca", "Texto", "Grafica / ilustracion", "Parche / etiqueta"],
      why: "identifica el arte que se debe producir",
      layer: "Diseno y referencias",
      example: "Ej.: logo Atelier Morfe, parche tejido o grafica trasera.",
    },
    {
      key: "application_position",
      label: "Ubicacion exacta",
      category: "design",
      designSlot: "application_1",
      designField: "position",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Pecho izquierdo", "Centro de espalda", "Manga", "Bajo / etiqueta"],
      why: "define la colocacion para patron y arte",
      layer: "Diseno y referencias",
      example: "Ej.: 90 mm bajo la punta de hombro, centrado al frente.",
    },
    {
      key: "application_technique",
      label: "Tecnica de aplicacion",
      category: "design",
      designSlot: "application_1",
      designField: "technique",
      status: FIELD_STATUS.ASK,
      value: "",
      options: ["Bordado", "Serigrafia", "DTF", "Parche cosido"],
      why: "define proceso, archivo y control de calidad",
      layer: "Diseno y referencias",
      example: "Ej.: bordado plano de 65 mm o serigrafia a 2 tintas.",
    },
  ]
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
export async function analyzeDesignExpression({ garmentType, generalFields, tecs, lang = "ES", onProgress, onStatus, signal }) {
  const generalText = generalFields && generalFields.length > 0 ? JSON.stringify(generalFields) : "(sin datos de construccion)"
  const instructions =
    "Sos un disenador tecnico textil experto definiendo las paginas de diseno de una ficha tecnica para una prenda tipo '" + garmentType + "'. " +
    "Ya tenemos definidos los campos de construccion general (tela, cuello, manga, etc.): " + generalText + ". " +
    "Ahora pensa SOLO en elementos DISCRETOS que necesitan su propia pagina de diseno en la ficha tecnica: " +
    "cosas con su propio arte/referencia, un link de Drive, o una especificacion de bordado/estampado/parche/etiqueta/herraje personalizado. " +
    "NO preguntes de nuevo por atributos de construccion planos (esos ya estan).\n\n" +
    "Para cada elemento de diseno, pensalo como un GRUPO de 2 a 4 campos relacionados que juntos describen ESE elemento. " +
    "Todos los campos de un mismo grupo comparten un mismo 'designSlot': un identificador corto, url-safe, en ingles y lowercase, " +
    "derivado del elemento REAL de esta prenda (por ejemplo 'main_logo', 'woven_label', 'buttons').\n" +
    "Cada campo del grupo debe incluir 'designField', que es uno de exactamente: 'name' (nombre humano del elemento, nombrando la " +
    "ubicacion real en ESTA prenda), " +
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
    "ANATOMIA - regla dura: solo podes nombrar ubicaciones que existan FISICAMENTE en una '" + garmentType + "'. " +
    "Antes de escribir una posicion, preguntate si esa parte existe en esta prenda. Unas medias no tienen pecho ni " +
    "espalda: sus ubicaciones son puno, tobillo, empeine, talon, planta. Un pantalon no tiene manga ni cuello. " +
    "Nombrar una parte que la prenda no tiene invalida la ficha entera.\n" +
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
        task: HYBRID_TASKS.DESIGNS,
        validator: (content) => {
          const value = normalizeRequirements(parseJSONOrRepair(content, "invalid designs"), garmentType)
          return value.fields.every((field) => field.category === "design" && field.designSlot && DESIGN_FIELD_KINDS.has(field.designField))
        },
        fallback: JSON.stringify({ garmentType, fields: [] }),
        onStatus,
        signal,
        onEvent: ({ contentSoFar, tokensSoFar, provider }) => onProgress(streamProgress(contentSoFar, tokensSoFar, provider)),
      })
    : await deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        task: HYBRID_TASKS.DESIGNS,
        validator: (content) => {
          const value = normalizeRequirements(parseJSONOrRepair(content, "invalid designs"), garmentType)
          return value.fields.every((field) => field.category === "design" && field.designSlot && DESIGN_FIELD_KINDS.has(field.designField))
        },
        fallback: JSON.stringify({ garmentType, fields: [] }),
        onStatus,
        signal,
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
export async function authorIllustrationBriefs({ garmentType, designs, lang = "ES", onProgress, onStatus, signal }) {
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
        task: HYBRID_TASKS.BRIEFS,
        validator: (content) => {
          const value = parseJSONOrRepair(content, "invalid briefs")
          const names = new Set((value.briefs || []).map((brief) => brief && brief.name))
          return value.briefs.length === designs.length && designs.every((design) => names.has(design.name))
        },
        fallback: () => JSON.stringify({ briefs: designs.map((design) => ({ name: design.name, illustrationBrief: `Dibujar ${design.name} en ${design.pos || "la ubicacion confirmada"}. Marcar tecnica ${design.tec || "PENDIENTE DE CONFIRMAR"} y no inferir medidas.` })) }),
        onStatus,
        signal,
        onEvent: ({ contentSoFar, tokensSoFar, provider }) => onProgress(streamProgress(contentSoFar, tokensSoFar, provider)),
      })
    : await deepseekChat({
        messages: [{ role: "user", content: instructions }],
        maxTokens: 3800,
        temperature: 0.2,
        task: HYBRID_TASKS.BRIEFS,
        validator: (content) => {
          const value = parseJSONOrRepair(content, "invalid briefs")
          const names = new Set((value.briefs || []).map((brief) => brief && brief.name))
          return value.briefs.length === designs.length && designs.every((design) => names.has(design.name))
        },
        fallback: () => JSON.stringify({ briefs: designs.map((design) => ({ name: design.name, illustrationBrief: `Dibujar ${design.name} en ${design.pos || "la ubicacion confirmada"}. Marcar tecnica ${design.tec || "PENDIENTE DE CONFIRMAR"} y no inferir medidas.` })) }),
        onStatus,
        signal,
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

// Small, cheap, non-streaming call: answers a clarifying question ABOUT the
// current field/options without advancing the walk (see looksLikeQuestion) -
// plain text, no JSON, no options/status semantics, same spirit as
// authorIllustrationBriefs' "this is prose for a human, not a question shape."
export async function answerFieldQuestion({ field, garmentType, question, lang = "ES", onStatus, onProgress, signal }) {
  const f = field || {}
  const optionsText = Array.isArray(f.options) && f.options.length > 0 ? "Opciones sugeridas: " + f.options.join(", ") + ". " : ""
  const instructions =
    "Sos un tecnico textil experto ayudando a alguien a completar la ficha tecnica de una prenda tipo '" + (garmentType || "prenda") + "'. " +
    "Te estan preguntando sobre este campo puntual del formulario: \"" + (f.label || "") + "\"" + (f.why ? " (" + f.why + ")" : "") + ". " +
    optionsText +
    "Pregunta del usuario: \"" + (question || "") + "\"\n\n" +
    "Respondé de forma clara y breve (maximo 3 oraciones), en espanol, explicando el termino o resolviendo la duda. " +
    "No le devuelvas una pregunta, no uses JSON, solo el texto de la respuesta."

  const request = {
    messages: [{ role: "user", content: instructions }],
    maxTokens: 300,
    temperature: 0.3,
    task: HYBRID_TASKS.EXPLAIN,
    validator: (content) => typeof content === "string" && content.trim().length >= 10,
    fallback: `${f.label || "Este campo"} define una decision tecnica de la prenda. ${f.why || "Afecta como la fabrica interpreta y construye el producto."} ${optionsText}`.trim(),
    onStatus,
    signal,
  }
  const raw = onProgress
    ? await deepseekChatStream({ ...request, onEvent: ({ contentSoFar, provider }) => onProgress({ contentSoFar, provider }) })
    : await deepseekChat(request)
  return raw.replace(/```/g, "").trim()
}

// Final open-ended pass (runs once the whole walk is done, before "ready"):
// turns free text the user typed into real fields using the SAME shape
// normalizeRequirements() already produces, so it merges into reqs with zero
// new plumbing - reqsToParts/reqsToDesigns pick these up exactly like any
// other answered field. Forced to "known" status since this is the user
// directly stating a fact, not something left to ask about.
export async function analyzeAdditionalNotes({ garmentType, existingFields, notes, lang = "ES", onStatus, signal }) {
  const existingText = Array.isArray(existingFields) && existingFields.length > 0
    ? JSON.stringify(existingFields.map((f) => ({ label: f.label, value: f.value })))
    : "(ninguno)"
  const instructions =
    "Sos un tecnico textil experto completando la ficha tecnica de una prenda tipo '" + (garmentType || "prenda") + "'. " +
    "Ya se respondieron estos campos: " + existingText + ".\n\n" +
    "El usuario acaba de agregar, en sus propias palabras, algo que cree que no se pregunto todavia:\n\"" + (notes || "") + "\"\n\n" +
    "Extrae de ese texto los campos NUEVOS y concretos que describe (que no esten ya cubiertos arriba). " +
    "Si describe un elemento de diseno (logo, bordado, parche, etc.) con su propio campo 'category':'design', usa 'designSlot' " +
    "(id corto, url-safe, en ingles) y 'designField' (uno de: name, position, technique, driveLink, detail) igual que siempre. " +
    "Si no hay nada nuevo o estructurable, devolve un array 'fields' vacio - no inventes nada.\n\n" +
    "Cada field debe tener status:\"known\" (son afirmaciones directas, no preguntas) y su 'value' con lo que dijo el usuario.\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"fields": [{"key": "identificadorEnIngles", "label": "Etiqueta en espanol", "category": "general", "status": "known", "value": "lo que dijo"}]}'

  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    maxTokens: 1200,
    temperature: 0.2,
    task: HYBRID_TASKS.NOTES,
    validator: (content) => Array.isArray(parseJSONOrRepair(content, "invalid notes").fields),
    fallback: JSON.stringify({ fields: [] }),
    onStatus,
    signal,
  })
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no pudo interpretar esas notas.")
  return normalizeRequirements(parsed, garmentType).fields
}
