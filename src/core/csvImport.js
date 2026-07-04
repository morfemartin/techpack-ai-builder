import { extractStructured } from "./deepseekClient.js"
import { uid } from "./idGen.js"

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
    "agrega tambien un objeto 'emb' a ese diseno con estas claves exactas: machine, stitches, colorChanges, stops, trims, fabric, stabTopping, stabBacking, appliques, w, h, area, maxStitch, minStitch, maxJump, totalThread, totalBobbin, stopSeq (array de {stop,color,stitches,code,name}). " +
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

  return {
    parts: mapParts(Array.isArray(result.parts) ? result.parts : [], garment, lang),
    designs: Array.isArray(result.designs) ? result.designs : [],
  }
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
