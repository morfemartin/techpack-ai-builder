export const VISION_PROMPT_VERSION = "garment-observation/v3"

export const VISION_CATEGORIES = [
  "color",
  "material_appearance",
  "silhouette",
  "construction",
  "closure",
  "pocket",
  "waistband",
  "finish",
  "artwork",
  "label_text",
]

const CATEGORY_SET = new Set(VISION_CATEGORIES)
const CERTAINTY_SET = new Set(["high", "medium", "low"])

const SEED_LABELS = {
  color: "Color visible",
  material_appearance: "Tela aparente",
  silhouette: "Silueta visible",
  construction: "Construccion visible",
  closure: "Cierre visible",
  pocket: "Bolsillos visibles",
  waistband: "Pretina visible",
  finish: "Terminaciones visibles",
  artwork: "Diseno o aplicacion visible",
  label_text: "Texto o etiqueta visible",
}

function cleanText(value, max = 280) {
  return typeof value === "string" ? value.replace(/[*`_]+/g, "").replace(/\s+/g, " ").trim().slice(0, max) : ""
}

function normalize(value) {
  return cleanText(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function isUnknownValue(value) {
  const key = normalize(value)
  if (/^(there is |there are )?no visible\b/.test(key)) return true
  if (/^(there is )?no (hood|pocket|artwork|graphic|label|text|cuff|waistband)/.test(key)) return true
  return !key || [
    "unknown", "none", "no", "solid", "n a", "not visible", "none visible", "no visible", "nothing visible",
    "no se ve", "no visible en la imagen", "no determinado", "no aplica",
  ].includes(key)
}

function canonicalObservation(category, attribute, value, certainty = "high") {
  const clean = cleanText(Array.isArray(value) ? value.join(", ") : value)
  if (!CATEGORY_SET.has(category) || isUnknownValue(clean)) return null
  return { category, attribute, value: clean, certainty }
}

function categoryForAttribute(attribute, fallback) {
  const key = normalize(attribute)
  if (/^color\b/.test(key)) return "color"
  if (/^pocket\b/.test(key)) return "pocket"
  if (/^cuff\b|^hem\b|^finish\b/.test(key)) return "finish"
  if (/^hood\b|^collar\b|^shoulder\b|^seam\b|^construction\b/.test(key)) return "construction"
  if (/^closure\b|^zipper\b|^button\b/.test(key)) return "closure"
  if (/^waist/.test(key)) return "waistband"
  if (/^artwork\b|^print\b|^graphic\b/.test(key)) return "artwork"
  if (/^label\b|^text\b/.test(key)) return "label_text"
  if (/^material\b|^surface\b|^texture\b/.test(key)) return "material_appearance"
  return fallback
}

function canonicalToObservations(parsed) {
  if (!parsed || typeof parsed !== "object") return []
  const closure = cleanText(parsed.frontClosure, 120)
  const closureEvidence = normalize(parsed.closureEvidence)
  const closureNeedsHardware = /zipper|button|snap|fly|cremallera|boton|broche|bragueta/.test(normalize(closure))
  const hasHardwareEvidence = /zipper teeth|zipper pull|pull tab|slider|visible button|button visible|buttonhole|snap visible|visible snap|eyelet|grommet|dientes|tirador|cursor|boton visible|ojal|broche visible/.test(closureEvidence)
  const hasPulloverEvidence = /no front opening|continuous front|pullover|sin abertura frontal|frente continuo/.test(closureEvidence)
  const acceptedClosure = closureNeedsHardware ? (hasHardwareEvidence ? closure : "")
    : /pullover|no front opening|sin cierre|sin abertura/.test(normalize(closure)) ? (hasPulloverEvidence ? closure : "")
      : ""
  const observations = [
    canonicalObservation("color", "color.base", parsed.baseColor),
    canonicalObservation("material_appearance", "material.appearance", parsed.materialAppearance, "medium"),
    canonicalObservation("silhouette", "silhouette.fit", parsed.fit),
    canonicalObservation("construction", "construction.shoulder", parsed.shoulder),
    canonicalObservation("construction", "construction.collar", parsed.collar),
    canonicalObservation("construction", "construction.pleats", parsed.pleats),
    canonicalObservation("silhouette", "silhouette.length", parsed.length),
    canonicalObservation("silhouette", "silhouette.leg", parsed.legSilhouette),
    canonicalObservation("construction", "construction.hood", parsed.hood),
    canonicalObservation("closure", "closure.front", acceptedClosure),
    canonicalObservation("finish", "finish.cuffs", parsed.cuffs),
    canonicalObservation("finish", "finish.hem", parsed.hem),
    canonicalObservation("waistband", "waistband.primary", parsed.waistband),
    canonicalObservation("label_text", "label.visible", parsed.labelText, "medium"),
    canonicalObservation("artwork", "artwork.pattern", parsed.pattern, "medium"),
  ].filter(Boolean)

  const pockets = Array.isArray(parsed.pockets) ? parsed.pockets : []
  pockets.forEach((pocket, index) => {
    if (!pocket || typeof pocket !== "object") return
    const type = cleanText(pocket.type, 80)
    const location = cleanText(pocket.location, 80)
    if (isUnknownValue(type)) return
    const value = [type, location && `at ${location}`].filter(Boolean).join(" ")
    const item = canonicalObservation("pocket", `pocket.${normalize(location) || index}.${normalize(type) || "unknown"}`, value)
    if (item) observations.push(item)
  })

  ;[
    ["visibleConstruction", "construction", "construction.visible"],
    ["artwork", "artwork", "artwork.visible"],
  ].forEach(([key, category, prefix]) => {
    const values = Array.isArray(parsed[key]) ? parsed[key] : isUnknownValue(parsed[key]) ? [] : [parsed[key]]
    values.forEach((value, index) => {
      const text = typeof value === "string"
        ? value
        : value && [value.type, value.description || value.value, value.color, value.location].filter(Boolean).join(" ")
      if (category === "artwork" && !/\b(artwork|logo|letter\w*|text|graphic|embroider\w*|appliqu\w*|print\w*|bordad\w*|estampad\w*)\b/.test(normalize(cleanText(text)))) return
      const item = canonicalObservation(category, `${prefix}.${index}`, text, "medium")
      if (item) observations.push(item)
    })
  })
  return observations
}

export function parseVisionJSON(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const starts = [...cleaned.matchAll(/\{/g)].map((match) => match.index)
    const ends = [...cleaned.matchAll(/\}/g)].map((match) => match.index).reverse()
    for (const start of starts) {
      for (const end of ends) {
        if (end <= start) continue
        try { return JSON.parse(cleaned.slice(start, end + 1)) } catch {}
      }
    }
  }

  // Small vision models sometimes obey the fields but wrap them in a
  // checklist. Recover only explicit labelled values, never free prose.
  const labels = {}
  cleaned.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:[-*]+\s*)?(?:\*\*)?([^:*]+?)(?:\*\*)?\s*:\s*(.+?)\s*$/)
    if (match) labels[normalize(match[1])] = cleanText(match[2], 500)
  })
  const pick = (...keys) => keys.map((key) => labels[normalize(key)]).find(Boolean) || ""
  const garmentType = pick("garment type", "tipo de prenda")
  const view = pick("view", "vista")
  const baseColor = pick("base color", "color base", "color")
  if (!garmentType && !view && !baseColor) {
    const sentences = cleaned.split(/(?<=[.!?])\s+/).map((sentence) => cleanText(sentence, 500)).filter(Boolean)
    const findSentence = (pattern) => sentences.find((sentence) => pattern.test(normalize(sentence))) || ""
    const garment = normalize(cleaned).match(/\b(boardshorts?|swim trunks?|hoodie|jacket|coat|shorts?|pants|trousers?|jeans?|skirt|shirt|sweater|sweatshirt|dress)\b/)?.[1] || ""
    const fit = normalize(cleaned).match(/\b(fitted|regular|relaxed|oversized|loose|boxy)\b/)?.[1] || ""
    const artwork = sentences.filter((sentence) => /\b(artwork|logo|letter\w*|graphic|embroider\w*|appliqu\w*|print\w*|texto|bordad\w*|estampad\w*)\b/.test(normalize(sentence))).slice(0, 2)
    const pocketSentence = findSentence(/\b(pocket|bolsillo)\b/)
    const closureSentence = findSentence(/\b(zipper|button|snap|fly|closure|cremallera|boton|broche|cierre)\b/)
    const materialSentence = findSentence(/\b(faux fur|fur|fuzzy|shaggy|fleece|corduroy|ribbed|denim|woven|knit|pelo|pana)\b/)
    const materialAppearance = normalize(materialSentence).match(/\b(faux fur|fur|fuzzy|shaggy|fleece|corduroy|ribbed|denim|smooth woven|woven|knit|pelo|pana)\b/)?.[1] || ""
    const collarSentence = findSentence(/\b(collar|neck|cuello)\b/)
    const cuffSentence = findSentence(/\b(cuff|puno)\b/)
    const hemSentence = findSentence(/\b(hem|bajo)\b/)
    if (!fit && artwork.length === 0 && !pocketSentence && !materialSentence && !closureSentence && !collarSentence && !cuffSentence && !hemSentence) return null
    const textKey = normalize(cleaned)
    const inferredView = /\b(back|rear|espalda|trasera)\b/.test(textKey) ? "back"
      : /\b(front|frente|frontal)\b/.test(textKey) ? "front"
        : /\b(side|lateral)\b/.test(textKey) ? "side" : "unknown"
    const color = textKey.match(/\b(black|white|brown|tan|beige|navy|blue|gray|grey|red|green|yellow|orange|purple|pink|negro|blanco|marron|azul|gris|rojo|verde)\b/)?.[1] || ""
    return {
      garmentType: garment,
      view: inferredView,
      baseColor: color,
      materialAppearance,
      fit,
      shoulder: findSentence(/\b(shoulder|hombro|raglan|set in|drop shoulder)\b/),
      hood: /\bhood|capucha\b/.test(textKey) ? "present" : "",
      collar: collarSentence,
      pockets: pocketSentence ? [{ type: pocketSentence, location: "" }] : [],
      frontClosure: closureSentence,
      closureEvidence: "",
      cuffs: cuffSentence,
      hem: hemSentence,
      waistband: findSentence(/\b(waistband|pretina|cintura)\b/),
      artwork,
      labelText: "",
      unknown: [],
    }
  }
  const pockets = pick("pockets", "bolsillos")
  const visibleConstruction = pick("visible construction", "construccion visible")
  const artwork = pick("artwork", "arte", "diseno")
  const unknown = pick("unknown", "desconocido", "pendiente")
  return {
    garmentType,
    view,
    baseColor,
    materialAppearance: pick("material appearance", "apariencia del material", "tela aparente"),
    fit: pick("fit", "calce", "silueta"),
    shoulder: pick("shoulder", "hombro"),
    length: pick("length", "largo"),
    hood: pick("hood", "capucha"),
    frontClosure: pick("front closure", "cierre frontal", "cierre"),
    closureEvidence: pick("closure evidence", "evidencia de cierre"),
    pockets: pockets && !isUnknownValue(pockets) ? [{ type: pockets, location: "" }] : [],
    cuffs: pick("cuffs", "punos"),
    hem: pick("hem", "bajo"),
    waistband: pick("waistband", "pretina", "cintura"),
    visibleConstruction: visibleConstruction && !isUnknownValue(visibleConstruction) ? [visibleConstruction] : [],
    artwork: artwork && !isUnknownValue(artwork) ? [artwork] : [],
    labelText: pick("label text", "texto de etiqueta", "etiqueta"),
    unknown: unknown && !isUnknownValue(unknown) ? [unknown] : [],
  }
}

export function normalizeVisionAnalysis(parsed, source = {}) {
  const garmentType = cleanText(parsed && parsed.garmentType, 80)
  const rawView = cleanText(parsed && parsed.view, 80)
  const viewKey = normalize(rawView)
  const view = rawView.includes("|") ? "unknown"
    : /\bback\b|\btrasera\b|\bespalda\b/.test(viewKey) ? "back"
      : /\bfront\b|\bfrontal\b|\bfrente\b/.test(viewKey) ? "front"
        : /\bside\b|\blateral\b/.test(viewKey) ? "side"
          : rawView === "detail" ? "detail" : "unknown"
  const observations = []
  const legacySeed = {}

  canonicalToObservations(parsed).forEach((item) => {
    observations.push({
      ...item,
      sourceKind: source.kind || "full",
      sourceLabel: source.quadrantLabel || (source.kind === "quadrant" ? "detalle" : "vista completa"),
      sourcePass: source.pass || (source.kind === "quadrant" ? "detail" : "identity"),
    })
  })

  if (parsed && Array.isArray(parsed.observations)) {
    parsed.observations.forEach((item) => {
      if (!item || !CATEGORY_SET.has(item.category)) return
      const value = cleanText(item.value)
      if (isUnknownValue(value)) return
      const attribute = cleanText(item.attribute, 100)
      const observation = {
        category: categoryForAttribute(attribute, item.category),
        value,
        certainty: CERTAINTY_SET.has(item.certainty) ? item.certainty : "medium",
        sourceKind: source.kind || "full",
        sourceLabel: source.quadrantLabel || (source.kind === "quadrant" ? "detalle" : "vista completa"),
        sourcePass: source.pass || (source.kind === "quadrant" ? "detail" : "identity"),
      }
      if (attribute) observation.attribute = attribute
      observations.push(observation)
    })
  } else if (parsed && parsed.seed && typeof parsed.seed === "object" && !Array.isArray(parsed.seed)) {
    // Backward-compatible salvage for providers or cached replies still using
    // the v1 free-key seed contract. Unknown keys are construction evidence;
    // this path is intentionally conservative and never invents categories.
    Object.entries(parsed.seed).forEach(([key, rawValue]) => {
      const value = cleanText(rawValue)
      if (!value) return
      legacySeed[key] = value
      const keyName = normalize(key)
      const category = keyName.includes("color") ? "color"
        : /tela|tejido|material|textura/.test(keyName) ? "material_appearance"
          : /cierre|boton|zipper|cremallera/.test(keyName) ? "closure"
            : /bolsillo/.test(keyName) ? "pocket"
              : /pretina|cintura|cordon/.test(keyName) ? "waistband"
                : /logo|bordado|estampado|diseno|grafica/.test(keyName) ? "artwork"
                  : "construction"
      observations.push({ category, value, certainty: "medium", sourceKind: source.kind || "full", sourceLabel: source.quadrantLabel || "vista completa", sourcePass: source.pass || "identity" })
    })
  }

  const rawUnknown = parsed && parsed.unknown
  const unknown = (Array.isArray(rawUnknown) ? rawUnknown : isUnknownValue(rawUnknown) ? [] : [rawUnknown])
    .map((item) => cleanText(item, 120)).filter(Boolean)
  return { garmentType, view, observations, unknown, legacySeed, sourcePass: source.pass || (source.kind === "quadrant" ? "detail" : "identity"), promptVersion: VISION_PROMPT_VERSION }
}

function observationRank(observation) {
  const source = observation.sourcePass === "verification" ? 50
    : observation.sourcePass === "surface" ? 45
    : observation.sourcePass === "construction" ? 40
      : observation.sourceKind === "full" ? 30 : 20
  const certainty = observation.certainty === "high" ? 3 : observation.certainty === "medium" ? 2 : 1
  return source + certainty
}

export function mergeVisionAnalyses(results) {
  const safe = Array.isArray(results) ? results.filter(Boolean) : []
  const garmentType = (safe.find((result) => result.garmentType) || {}).garmentType || ""
  const view = ([...safe].sort((a, b) => {
    const rank = { orientation: 4, verification: 3, construction: 2, classification: 1.5, identity: 1, detail: 0 }
    return (rank[b.sourcePass] || 0) - (rank[a.sourcePass] || 0)
  }).find((result) => result.view && result.view !== "unknown" && result.view !== "detail") || {}).view || "unknown"
  const byClaim = new Map()
  const supportByClaim = new Map()

  safe.forEach((result) => {
    ;(result.observations || []).forEach((observation) => {
      const key = observation.attribute
        ? observation.category + ":" + normalize(observation.attribute)
        : observation.category + ":" + normalize(observation.value)
      if (!normalize(observation.value)) return
      const existing = byClaim.get(key)
      if (!supportByClaim.has(key)) supportByClaim.set(key, new Set())
      supportByClaim.get(key).add(`${observation.sourcePass || observation.sourceLabel}:${normalize(observation.value)}`)
      if (!existing || observationRank(observation) > observationRank(existing)) byClaim.set(key, observation)
    })
  })

  const unknownSeen = new Set()
  const unknown = []
  const legacySeed = {}
  safe.forEach((result) => {
    Object.entries(result.legacySeed || {}).forEach(([key, value]) => {
      if (!(key in legacySeed)) legacySeed[key] = value
    })
    ;(result.unknown || []).forEach((item) => {
      const key = normalize(item)
      if (key && !unknownSeen.has(key)) {
        unknownSeen.add(key)
        unknown.push(item)
      }
    })
  })

  const observations = [...byClaim.entries()].filter(([key, observation]) => {
    if (observation.category !== "closure") return true
    return (supportByClaim.get(key) || new Set()).size >= 2
  }).map(([, observation]) => {
    if (observation.category !== "pocket" || !/^back$/i.test(cleanText(view))) return observation
    if (/\b(back|rear)\s+pocket\b/i.test(observation.value)) return observation
    return { ...observation, value: observation.value + "; rear pocket visible" }
  })

  return {
    garmentType,
    view,
    observations,
    unknown,
    legacySeed,
    promptVersion: VISION_PROMPT_VERSION,
  }
}

export function visionAnalysisToSeed(analysis) {
  const grouped = new Map()
  ;(analysis && analysis.observations || []).forEach((observation) => {
    if (!SEED_LABELS[observation.category]) return
    if (!grouped.has(observation.category)) grouped.set(observation.category, [])
    const values = grouped.get(observation.category)
    if (!values.some((value) => normalize(value) === normalize(observation.value))) values.push(observation.value)
  })
  const seed = {}
  if (analysis && analysis.view && analysis.view !== "unknown") seed["Vista observada"] = analysis.view
  for (const [category, values] of grouped) seed[SEED_LABELS[category]] = values.join("; ")
  return seed
}

export function buildGarmentVisionPrompt({ kind = "full", quadrantLabel = "", pass = "identity", garmentType = "" } = {}) {
  const quadrant = kind === "quadrant"
  if (quadrant) {
    return [
      "ROLE: Senior garment technician extracting evidence for a factory tech pack.",
      `SCOPE: This is only the ${quadrantLabel || "detail"} quadrant of a larger photo. It is not a complete garment view.`,
      "INSPECT LOCALLY: every fully visible color or pattern, surface texture, seam or panel, closure or hardware, pocket opening, waistband/drawcord/eyelet, cuff, hem, artwork, label and readable text. A garment can be framed in any position, so use only what this crop actually contains.",
      "Do not identify the complete garment, fit, view or overall silhouette from this crop. Do not reinterpret partial edges as collars, waistbands, pockets or artwork.",
      "Record only a detail whose complete visible shape supports the claim. Use canonical garment terms. Material is visual appearance only.",
      "Never infer fiber, composition, GSM, measurements, supplier, hidden construction, hidden lining, stitch type or a view not shown.",
      "ATTRIBUTE: Use a stable slot name beginning with color, material, construction, closure, pocket, waistband, finish, artwork or label. Category and attribute must describe the same fact.",
      "Return only valid JSON with this exact schema:",
      '{"garmentType":"","view":"detail","observations":[{"category":"color|material_appearance|construction|closure|pocket|waistband|finish|artwork|label_text","attribute":"","value":"","certainty":"high|medium|low"}],"unknown":[]}',
    ].join("\n")
  }
  if (pass === "classification") {
    return [
      "Inspect only the documented garment; ignore person, background and accessories.",
      "Identify its exact garment category and whether the photographed side is front, back, side or unknown. Do not default to front.",
      'Return only JSON: {"garmentType":"","view":"front|back|side|unknown"}',
    ].join("\n")
  }
  if (pass === "orientation") {
    return [
      "Classify only whether the photographed side of the documented garment is FRONT, BACK, SIDE or UNKNOWN.",
      "Use direct garment evidence: fly/front opening, placket, kangaroo or front slant pockets versus rear patch/welt pockets, back waistband label, back yoke or artwork across the back. Do not default to front and ignore the person/background.",
      'Return only JSON: {"view":"front|back|side|unknown","viewEvidence":["visible cue"]}',
    ].join("\n")
  }
  if (pass === "surface") {
    const lowerBody = /short|trouser|pant|jean|skirt|skort|bermuda|boardshort|swim trunk/i.test(garmentType)
    return lowerBody
      ? [
          "Inspect only the documented lower-body garment; ignore person, background and external logos.",
          "Verify overall fit, garment length, hem finish, every visible pattern/artwork with colors and location, and readable garment labels. Do not infer fiber or hidden details.",
          'Return only JSON: {"fit":"fitted|regular|relaxed|oversized|unknown","length":"","hem":"","artwork":[],"labelText":"","unknown":[]}',
        ].join("\n")
      : [
          "Inspect only the documented upper-body garment; ignore person, background and external logos.",
          "Verify overall fit, shoulder shape, cuff and hem finish, and every visible garment artwork/text/logo with type, color and location. Do not infer fiber or hidden details.",
          'Return only JSON: {"fit":"fitted|regular|relaxed|oversized|unknown","shoulder":"","cuffs":"","hem":"","artwork":[],"labelText":"","unknown":[]}',
        ].join("\n")
  }
  if (pass === "artwork") {
    return [
      "Inspect only artwork, text, logos, embroidery, applique or print physically visible on the documented garment. Ignore the person, background, accessories, watermarks and external brand marks outside the garment.",
      "For each visible garment application, state type, readable text or shape, color and garment location. Use an empty array only when none is visible; do not guess illegible words.",
      'Return only JSON: {"artwork":[{"type":"","description":"","color":"","location":""}],"labelText":"","unknown":[]}',
    ].join("\n")
  }
  if (pass === "verification") {
    const lowerBody = /short|trouser|pant|jean|skirt|skort|bermuda|boardshort|swim trunk/i.test(garmentType)
    return lowerBody
      ? [
          "Inspect only this lower-body garment; ignore person and background.",
          "Answer: (1) front/back/side view with a visible cue; (2) exact pocket type and location, choosing patch, welt, slant, cargo, inseam or unknown; (3) visible waistband components such as belt loops, elastic, drawstring, eyelets or button; (4) visible pattern; (5) visible artwork type/location.",
          "Do not infer hidden features and do not default to front.",
          'Return only JSON: {"pockets":[{"type":"","location":""}],"waistband":"","pattern":"","artwork":[],"unknown":[]}',
        ].join("\n")
      : [
          "Inspect only this upper-body garment; ignore person and background.",
          "Answer: front/back/side view; collar; hood; exact pocket type/location; cuff finish; hem finish; and whether a front opening is directly visible.",
          "For a hoodie, distinguish one centered connected kangaroo pouch with two side openings from separate patch pockets. A zipper requires directly visible teeth or pull; otherwise use unknown.",
          'Return only JSON: {"collar":"","hood":"","pockets":[{"type":"","location":""}],"cuffs":"","hem":"","frontClosure":"","closureEvidence":"","unknown":[]}',
        ].join("\n")
  }
  if (pass === "construction") {
    const lowerBody = /short|trouser|pant|jean|skirt|skort|bermuda|boardshort|swim trunk/i.test(garmentType)
    const checklist = lowerBody
      ? "Inspect: exact garment category; waistband construction; visible button, fly, zipper, drawstring, eyelets or elastic; pleat number/type; pocket type and location; leg silhouette; garment length; hem; pattern/artwork; labels."
      : "Inspect: exact garment category; collar/neck; hood presence and apparent construction; front opening/closure; pocket type and location; shoulder construction; fit; cuffs; hem; pattern/artwork; labels."
    const schema = lowerBody
      ? '{"garmentType":"","view":"front|back|side|unknown","waistband":"","frontClosure":"","closureEvidence":"","pleats":"","pockets":[{"type":"","location":""}],"legSilhouette":"","length":"","hem":"","artwork":[],"labelText":"","unknown":[]}'
      : '{"garmentType":"","view":"front|back|side|unknown","collar":"","hood":"","frontClosure":"","closureEvidence":"","pockets":[{"type":"","location":""}],"shoulder":"","fit":"fitted|regular|relaxed|oversized|unknown","cuffs":"","hem":"","artwork":[],"labelText":"","unknown":[]}'
    return [
      "You are a garment construction technician. Ignore the person, background, styling accessories and external logos; inspect only the garment.",
      `Pass 1 suggested ${garmentType || "an unconfirmed garment"}. Verify it from the image.`,
      `Answer these visible questions one by one. ${checklist}`,
      "Use canonical garment terms. A zipper, button, snap or fly is valid only when its hardware is directly visible; closureEvidence must name that visible hardware. For a pullover, closureEvidence must state that no front opening is visible. A center seam or concealed opening is unknown. Never infer fiber, composition, GSM, measurements, supplier, hidden lining, hidden pockets or hidden construction.",
      "Return only this JSON object, with no prose or markdown:",
      schema,
    ].join("\n")
  }
  return [
    "ROLE: Senior garment identification technician.",
    "SCOPE: This is the FULL image. Ignore the person, styling accessories, background and external logos. Inspect only the garment being documented.",
    "TASK: Answer only five visual identity fields: exact garment category; photographed front/back/side view; base color and visible wash; pattern motif with every visible pattern color; surface appearance using canonical choices such as faux-fur/shaggy, fleece, corduroy/ribbed, denim, smooth woven, knit or unknown.",
    "VIEW RULE: Determine front versus back from visible fly/opening, front pocket shape, rear patch/welt pockets, back yoke, back label and artwork placement. Do not default to front.",
    "EVIDENCE: Material is appearance only. Never infer fiber, percentage, GSM, measurements, supplier, hidden construction or unseen views.",
    "Return only valid JSON, no markdown or explanation:",
    '{"garmentType":"","view":"front|back|side|unknown","baseColor":"","pattern":"","materialAppearance":"","unknown":[]}',
  ].join("\n")
}

export function parseFocusedVisionAnswer(raw, source = {}) {
  const parsed = parseVisionJSON(raw)
  if (!parsed) return { answer: "", evidence: [], certainty: "low", ...source }
  return {
    answer: cleanText(parsed.answer),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map((item) => cleanText(item, 140)).filter(Boolean) : [],
    certainty: CERTAINTY_SET.has(parsed.certainty) ? parsed.certainty : "low",
    sourceKind: source.kind || "full",
    sourceLabel: source.quadrantLabel || (source.kind === "quadrant" ? "detalle" : "vista completa"),
  }
}

export function mergeFocusedVisionAnswers(results) {
  const usable = (results || []).filter((result) => result && result.answer && !/^no se puede determinar/i.test(result.answer))
  if (usable.length === 0) return "No se puede determinar con certeza desde la foto."
  const certaintyRank = { high: 3, medium: 2, low: 1 }
  return [...usable].sort((a, b) => {
    const certainty = (certaintyRank[b.certainty] || 0) - (certaintyRank[a.certainty] || 0)
    if (certainty) return certainty
    const source = (b.sourceKind === "quadrant" ? 1 : 0) - (a.sourceKind === "quadrant" ? 1 : 0)
    if (source) return source
    return b.answer.length - a.answer.length
  })[0].answer
}

export function buildFocusedVisionPrompt(field, garmentType, segment = {}) {
  const optionsText = Array.isArray(field && field.options) && field.options.length
    ? `Opciones del formulario, solo si coinciden con evidencia: ${field.options.join(", ")}.`
    : ""
  return [
    "ROLE: Eres un tecnico textil senior examinando una foto para responder un solo campo de ficha tecnica.",
    `GARMENT CONTEXT: ${garmentType || "prenda no confirmada"}.`,
    `FIELD: ${(field && field.label) || "campo actual"}. ${(field && field.why) || ""}`,
    `SEGMENT: ${segment.kind === "quadrant" ? `cuadrante ${segment.quadrantLabel || "detalle"}` : "vista completa"}.`,
    optionsText,
    "Responde solo con evidencia visible en este segmento. Nunca inventes fibra, porcentaje, GSM, costo, medidas, proveedor o construccion oculta. Para tela indica apariencia, no composicion.",
    "Si el segmento no aporta evidencia, usa answer exactamente 'No se puede determinar con certeza desde la foto.'.",
    'Devuelve solo JSON valido: {"answer":"respuesta breve","evidence":["rasgo visible"],"certainty":"high|medium|low"}',
  ].filter(Boolean).join("\n")
}
