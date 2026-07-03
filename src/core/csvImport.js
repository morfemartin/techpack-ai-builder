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
 */
export async function importGarmentCSV(csvText, { garment, lang = "ES", tecs }) {
  const partLabels = garment.partLabels[lang] || garment.partLabels.ES
  const positions = garment.positions[lang] || garment.positions.ES
  const knownLabels = Object.values(partLabels)

  const instructions =
    "Sos un asistente que interpreta un CSV de datos de produccion para una prenda tipo '" + (garment.label[lang] || garment.id) + "'. " +
    "Lo lleno una persona a mano, puede tener columnas distintas, en cualquier orden, con encabezados en espanol o ingles. " +
    "Piezas de construccion conocidas para esta prenda: " + knownLabels.join(", ") + ". " +
    "Si una fila no corresponde a ninguna pieza conocida, usa su propio texto como etiqueta de todos modos - no la descartes. " +
    "Posiciones de diseno validas: " + positions.join(", ") + " - si un diseno no calza exacto, elegi la mas parecida de esa lista. " +
    "Tecnicas validas: " + (tecs || []).join(", ") + ". " +
    'Devolve JSON con esta forma exacta: {"parts":[{"label":"...","val":"...","on":true}],"designs":[{"name":"...","pos":"...","posDetail":"...","w":"","h":"","tec":"...","colors":[{"name":"...","hex":"#RRGGBB"}],"fileName":"","driveLink":""}]}. ' +
    "Los campos w/h son milimetros en mm (string vacio si no aplica). hex siempre en formato #RRGGBB - si el CSV solo trae un nombre Pantone sin hex, aproxima un hex razonable para ese color."

  const result = await extractStructured({ instructions, content: csvText, maxTokens: 3000 })

  return {
    parts: mapParts(Array.isArray(result.parts) ? result.parts : [], garment, lang),
    designs: Array.isArray(result.designs) ? result.designs : [],
  }
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
