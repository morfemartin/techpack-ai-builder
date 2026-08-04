import { extractStructured } from "./deepseekClient.js"
import { uid } from "./idGen.js"
import { EMB_FIELDS_PROMPT } from "./helpers.js"

// Reads a File as text. Kept separate from importGarmentCSV() (which takes
// plain text) so the actual parsing/mapping logic stays testable without a
// browser FileReader.
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/**
 * Extracts {parts, designs} from a loosely-formatted CSV via DeepSeek -
 * not a rigid column parser. Real CSVs get filled out by people, not
 * machines: columns, order, and even which fields are present will vary.
 * The model is given the garment's valid part labels/positions/techniques
 * so it can map free-form input onto them, and told to keep anything it
 * can't place rather than silently dropping it.
 *
 * imageFileNames (optional): names of photos uploaded alongside the CSV
 * (e.g. a Wilcom-style export with embroidery renders). DeepSeek is
 * text-only here - it never sees pixel data, only this filename list - so
 * it can only return a best-guess `imageHint` per design for
 * matchImagesToDesigns() to resolve, never a real visual match.
 */
export async function importGarmentCSV(csvText, { garment, lang = "ES", tecs, imageFileNames }) {
  const partLabels = garment.partLabels[lang] || garment.partLabels.ES
  const positions = garment.positions[lang] || garment.positions.ES
  const knownLabels = Object.values(partLabels)
  const tecList = tecs || []

  const instructions =
    "Sos un asistente que interpreta un CSV de datos de produccion para una prenda tipo '" + (garment.label[lang] || garment.id) + "'. " +
    "Lo lleno una persona a mano, puede tener columnas distintas, en cualquier orden, con encabezados en espanol o ingles. " +
    "Piezas de construccion conocidas para esta prenda: " + knownLabels.join(", ") + ". " +
    "Si una fila no corresponde a ninguna pieza conocida, usa su propio texto como etiqueta de todos modos - no la descartes. " +
    "Posiciones de diseno validas: " + positions.join(", ") + " - si un diseno no calza exacto, elegi la mas parecida de esa lista. " +
    "Tecnicas validas: " + tecList.join(", ") + ". " +
    "Si el CSV trae datos de digitalizado de bordado (puntadas, cambios de color, paradas, cortes, estabilizador top/backing, hilo/bobina - tipico de una ficha exportada de Wilcom), " +
    "agrega tambien un objeto 'emb' a ese diseno con estas claves exactas: " + EMB_FIELDS_PROMPT + ". " +
    "Dejá vacios (string vacio, o array vacio para stopSeq) los campos de emb que no encuentres. " +
    "Si agregas 'emb', el campo 'tec' de ese diseno DEBE ser exactamente uno de bordado de la lista de tecnicas de arriba - nunca un texto libre distinto." +
    (imageFileNames && imageFileNames.length > 0
      ? " Se subieron estas imagenes junto con el CSV: " + imageFileNames.join(", ") + ". Si alguna corresponde claramente a un diseno (por nombre de archivo, referencia en el texto, o contexto), agrega \"imageHint\": \"<nombre_de_archivo_exacto_de_la_lista>\" a ese diseno. Si ninguna corresponde con claridad, no agregues ese campo."
      : "") +
    ' Devolve JSON con esta forma exacta: {"parts":[{"label":"...","val":"...","on":true}],"designs":[{"name":"...","pos":"...","posDetail":"...","w":"","h":"","tec":"...","colors":[{"name":"...","hex":"#RRGGBB"}],"fileName":"","driveLink":"","emb":{...opcional...}' +
    (imageFileNames && imageFileNames.length > 0 ? ',"imageHint":"...opcional..."' : "") +
    "}]}. " +
    "Los campos w/h son milimetros en mm (string vacio si no aplica). hex siempre en formato #RRGGBB - si el CSV solo trae un nombre Pantone sin hex, aproxima un hex razonable para ese color."

  const result = await extractStructured({ instructions, content: csvText, maxTokens: 3000 })
  const rawParts = Array.isArray(result.parts) ? result.parts : []

  return {
    parts: mapParts(rawParts, garment, lang),
    designs: Array.isArray(result.designs) ? result.designs : [],
    // Pre-reconciliation {label, val} pairs, kept alongside the canonical
    // `parts` above - mapParts() overlays these onto the garment's full
    // defaultParts list, so a part the CSV never mentioned reads as its
    // registered default, not as "missing". csvSeedToRequirementsSeed()
    // needs to know what the CSV actually said, not what got defaulted in.
    rawParts,
  }
}

// F2: what did the CSV actually tell us, in the shape analyzeRequirements()
// expects as a seed? Deliberately reads rawParts (pre-reconciliation), not
// the merged `parts` - a registered garment's defaultParts already cover
// every canonical field, so merging them in would make everything look
// "known" and defeat the point of checking for real gaps.
export function csvSeedToRequirementsSeed(csvResult) {
  const rawParts = csvResult && Array.isArray(csvResult.rawParts) ? csvResult.rawParts : []
  const seed = {}
  for (const p of rawParts) {
    if (!p) continue
    const label = String(p.label || "").trim()
    const val = String(p.val || "").trim()
    if (label && val) seed[label] = val
  }
  return seed
}

// Attaches uploaded photos to AI-extracted designs. DeepSeek can only ever
// return a filename hint (never real vision matching - see importGarmentCSV
// above), so this resolves that hint first, then falls back to pairing
// whatever's left over by upload/design order - the common case where
// there's one photo per row and nobody bothered typing a filename.
export function matchImagesToDesigns(designs, images) {
  const pool = images.slice()
  const result = designs.map((d) => Object.assign({}, d))

  result.forEach((d) => {
    if (!d.imageHint) return
    const hint = String(d.imageHint).toLowerCase().trim()
    const i = pool.findIndex((img) => img.fileName.toLowerCase().trim() === hint)
    if (i === -1) return
    const img = pool.splice(i, 1)[0]
    Object.assign(d, { imageData: img.imageData, imageType: img.imageType, imgNatW: img.imgNatW, imgNatH: img.imgNatH })
  })

  const imageless = result.filter((d) => !d.imageData)
  imageless.forEach((d, i) => {
    if (i >= pool.length) return
    const img = pool[i]
    Object.assign(d, { imageData: img.imageData, imageType: img.imageType, imgNatW: img.imgNatW, imgNatH: img.imgNatH })
  })
  const consumed = Math.min(imageless.length, pool.length)
  const unmatchedImages = pool.slice(consumed)

  return { designs: result, unmatchedImages }
}

// Reconciles the AI's {label, val, on} rows against the garment's canonical
// part list: known labels overlay onto their fixed id/order (so the result
// is always complete and correctly ordered, even from a partial CSV);
// anything unrecognized is appended as a custom part instead of dropped.
function mapParts(aiParts, garment, lang) {
  const partLabels = garment.partLabels[lang] || garment.partLabels.ES
  const byLabel = new Map()
  for (const [id, label] of Object.entries(partLabels)) {
    byLabel.set(String(label).toLowerCase().trim(), Number(id))
  }

  const overlay = new Map()
  const extras = []
  for (const p of aiParts) {
    const id = byLabel.get(String(p.label || "").toLowerCase().trim())
    if (id) overlay.set(id, { val: p.val || "", on: p.on !== false })
    else extras.push({ id: uid(), val: p.val || "", on: p.on !== false, customName: p.label || "Pieza" })
  }

  const base = garment.defaultParts.map((dp) => {
    const o = overlay.get(dp.id)
    return o ? { id: dp.id, val: o.val, on: o.on } : { ...dp }
  })
  return [...base, ...extras]
}

// For the CUSTOM/chat-built garment flow, which has no fixed part schema to
// reconcile against (unlike importGarmentCSV above, which needs
// garment.partLabels/positions/defaultParts) - so this is deliberately
// simpler: pull out whatever construction facts a document (CSV, or a
// Markdown/plain-text spec sheet someone already wrote) states, as flat
// {label: value} pairs, in the exact shape analyzeRequirements()'s `seed`
// and answerFromSeed() already expect. Never invents what the document
// doesn't say - if a fact isn't there, it's not in the returned seed, and
// the walk asks about it normally.
export async function extractSeedFromDocument(text, { garmentType, tecs } = {}) {
  const instructions =
    "Sos un asistente que interpreta un documento de datos de produccion (puede ser un CSV o notas en Markdown/texto libre) " +
    "para armar una ficha tecnica" + (garmentType ? " de una prenda tipo '" + garmentType + "'" : "") + ". " +
    "Extrae CADA dato de construccion o diseno que el documento YA provee, como pares clave-valor en espanol " +
    "(ej: \"Tipo de tela\": \"Jersey algodon\", \"Cuello\": \"Redondo rib\"). " +
    "NO inventes ni completes lo que el documento no dice explicitamente - si un dato no esta, no lo incluyas.\n" +
    (tecs && tecs.length > 0 ? "Tecnicas de aplicacion validas (por si el documento las menciona): " + tecs.join(", ") + ".\n" : "") +
    (garmentType ? "" : "Si el documento menciona o deja claro el tipo de prenda, agregalo como \"garmentType\".\n") +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"garmentType": "opcional si no se proveyo arriba", "facts": {"Etiqueta en espanol": "valor", "Otra etiqueta": "otro valor"}}'

  const result = await extractStructured({ instructions, content: text, maxTokens: 2500 })
  const rawFacts = result && result.facts && typeof result.facts === "object" && !Array.isArray(result.facts) ? result.facts : {}
  const seed = {}
  for (const [label, value] of Object.entries(rawFacts)) {
    const cleanLabel = String(label || "").trim()
    const cleanValue = String(value == null ? "" : value).trim()
    if (cleanLabel && cleanValue) seed[cleanLabel] = cleanValue
  }
  return {
    garmentType: typeof result.garmentType === "string" ? result.garmentType.trim() : "",
    seed,
  }
}

// A suggested (not required) CSV shape, so a person filling one out by hand
// has somewhere to start. importGarmentCSV() doesn't enforce this format.
export function buildExampleCSV(garment, lang = "ES") {
  const partLabels = garment.partLabels[lang] || garment.partLabels.ES
  const positions = garment.positions[lang] || garment.positions.ES
  const lines = ["tipo,etiqueta,valor,posicion,tecnica,pantone,hex,ancho_mm,alto_mm"]
  garment.defaultParts.slice(0, 5).forEach((p) => {
    lines.push(["pieza", partLabels[p.id] || "", p.val, "", "", "", "", "", ""].join(","))
  })
  lines.push(["diseno", "Logo Frontal", "", positions[3] || positions[0], "Bordado 3D", "PANTONE 286 C", "#003DA5", "111.6", "59.1"].join(","))
  return lines.join("\n")
}
