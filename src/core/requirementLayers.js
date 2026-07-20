// The deterministic intake contract. Models may discover garment-specific
// facts, but never decide whether the factory-critical layers are collected.
// Each template maps to a useful tech-pack datum and is written so a non-textile
// user can answer it without guessing professional terminology.

const ASK = "ask"
const KNOWN = "known"

function field({ key, label, layer, example, options, why, aliases = [] }) {
  return { key, label, category: "general", layer, example, options, why, aliases }
}

const COMMON = [
  field({
    key: "intended_use",
    label: "Uso principal",
    layer: "Producto y uso",
    example: "Ej.: polo de golf para calor, uniforme de hotel o uso casual.",
    options: ["Casual", "Uniforme", "Deportivo", "Outdoor"],
    why: "define desempeno, tela y tolerancias",
    aliases: ["uso", "uso principal", "actividad", "ocasion", "ocasion de uso"],
  }),
  field({
    key: "fabric",
    label: "Tela principal",
    layer: "Materiales",
    example: "Ej.: pique 220 g/m2, french terry o jersey liviano.",
    options: ["Algodon pique", "Jersey algodon", "Performance stretch", "Mezcla CVC"],
    why: "define tacto, caida, costo y proceso",
    aliases: ["tela", "tela principal", "material", "composicion", "fabric"],
  }),
  field({
    key: "fit",
    label: "Fit / silueta",
    layer: "Calce y talles",
    example: "Ej.: regular para uniforme, slim para golf o oversized urbano.",
    options: ["Regular", "Slim", "Relaxed", "Oversized"],
    why: "define patronaje y medidas",
    aliases: ["fit", "silueta", "calce", "ajuste", "corte"],
  }),
  field({
    key: "size_range",
    label: "Base de talles y medidas",
    layer: "Calce y talles",
    example: "Ej.: S-XXL con talla base M; o enviar prenda de referencia.",
    options: ["S a XL, base M", "XS a XXL, base M", "Talle unico", "Prenda de referencia"],
    why: "evita producir sin una base medible",
    aliases: ["talles", "talla", "rango de talles", "medidas", "size range"],
  }),
  field({
    key: "pockets",
    label: "Bolsillos",
    layer: "Construccion",
    example: "Ej.: sin bolsillo, pecho con cierre o dos laterales ocultos.",
    options: ["Sin bolsillo", "Pecho", "Laterales", "Canguro"],
    why: "cambia piezas, costuras y consumo",
    aliases: ["bolsillo", "bolsillos", "pocket", "pockets"],
  }),
  field({
    key: "closure",
    label: "Cierre / botonadura",
    layer: "Construccion",
    example: "Ej.: tres botones tono a tono, zipper YKK o sin cierre.",
    options: ["Botones", "Zipper", "Broches", "Sin cierre"],
    why: "define avios y operaciones",
    aliases: ["cierre", "botonadura", "botones", "zipper", "cremallera"],
  }),
  field({
    key: "finish",
    label: "Terminaciones visibles",
    layer: "Terminaciones",
    example: "Ej.: bajo con doble aguja, punos rib y etiqueta de cuello.",
    options: ["Dobladillo simple", "Doble aguja", "Rib", "Vivo / ribete"],
    why: "define acabado, maquinaria y control visual",
    aliases: ["terminacion", "terminaciones", "bajo", "punos", "acabado"],
  }),
  field({
    key: "production_notes",
    label: "Requisito de produccion",
    layer: "Produccion",
    example: "Ej.: antiolor, secado rapido, costura reforzada o sin requisito especial.",
    options: ["Sin requisito especial", "Secado rapido", "Alta durabilidad", "Antiolor / UV"],
    why: "convierte el uso en criterios de fabrica",
    aliases: ["requisito", "desempeno", "performance", "calidad", "produccion"],
  }),
  field({
    key: "applications",
    label: "Diseno, logo o aplicacion",
    layer: "Diseno y referencias",
    example: "Ej.: sin aplicacion, logo bordado en pecho o estampado grande en espalda.",
    options: ["Sin aplicacion", "Logo / bordado", "Estampado / print", "Varios elementos"],
    why: "abre las especificaciones de arte y ubicacion",
    aliases: ["diseno", "diseño", "logo", "aplicacion", "aplicación", "bordado", "estampado", "print"],
  }),
]

const POLO = [
  field({
    key: "collar",
    label: "Cuello",
    layer: "Construccion",
    example: "Ej.: cuello polo en rib con raya, auto tela o cuello plano.",
    options: ["Rib tejido", "Auto tela", "Cuello polo plano", "Con raya"],
    why: "cambia construccion superior",
    aliases: ["cuello", "collar", "cuello polo"],
  }),
  field({
    key: "sleeve",
    label: "Manga",
    layer: "Construccion",
    example: "Ej.: corta con rib, corta con dobladillo o larga.",
    options: ["Corta con rib", "Corta dobladillo", "Larga", "Raglan"],
    why: "define piezas y consumo",
    aliases: ["manga", "mangas", "sleeve"],
  }),
  field({
    key: "placket",
    label: "Tapeta",
    layer: "Construccion",
    example: "Ej.: tapeta de 3 botones, sin botones o zipper corto.",
    options: ["2 botones", "3 botones", "Sin botones", "Zipper corto"],
    why: "define frente, avios y refuerzos",
    aliases: ["tapeta", "placket"],
  }),
]

const HOODIE = [
  field({
    key: "hood",
    label: "Capucha",
    layer: "Construccion",
    example: "Ej.: doble tela con cordon, forrada o sin cordon.",
    options: ["Doble tela", "Forrada", "Con cordon", "Sin cordon"],
    why: "define consumo y operaciones",
    aliases: ["capucha", "hood"],
  }),
  field({
    key: "sleeve",
    label: "Manga",
    layer: "Construccion",
    example: "Ej.: manga montada con puno rib o raglan deportiva.",
    options: ["Montada con rib", "Raglan", "Sin puno", "Con abertura pulgar"],
    why: "define piezas y costuras",
    aliases: ["manga", "mangas", "sleeve"],
  }),
  field({
    key: "lining",
    label: "Interior / forro",
    layer: "Materiales",
    example: "Ej.: sin forro, french terry interno o polar cepillado.",
    options: ["Sin forro", "French terry", "Polar cepillado", "Malla interior"],
    why: "define abrigo y consumo",
    aliases: ["forro", "interior", "lining"],
  }),
]

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function garmentTemplates(garmentType) {
  const name = normalize(garmentType)
  if (/polo/.test(name)) return [...COMMON, ...POLO]
  if (/hoodie|sudadera|buzo|capucha/.test(name)) return [...COMMON, ...HOODIE]
  return [...COMMON, field({
    key: "neckline",
    label: "Cuello / escote",
    layer: "Construccion",
    example: "Ej.: redondo rib, V, mao o sin cuello.",
    options: ["Redondo rib", "En V", "Mao", "Sin cuello"],
    why: "define piezas superiores y acabados",
    aliases: ["cuello", "escote", "neckline"],
  }), field({
    key: "sleeve",
    label: "Manga",
    layer: "Construccion",
    example: "Ej.: corta con dobladillo, larga con puno o sin manga.",
    options: ["Corta", "Larga", "Raglan", "Sin manga"],
    why: "define piezas y consumo",
    aliases: ["manga", "mangas", "sleeve"],
  })]
}

function factsFrom(seed, fields) {
  const facts = []
  Object.entries(seed || {}).forEach(([key, value]) => {
    if (String(value || "").trim()) facts.push({ key, label: key, value: String(value).trim() })
  })
  ;(fields || []).forEach((item) => {
    if (item && item.category === "general" && item.status !== ASK && String(item.value || "").trim()) {
      facts.push({ key: item.key, label: item.label, value: String(item.value).trim() })
    }
  })
  return facts
}

function matchingFact(template, facts) {
  const aliases = [template.key, template.label, ...template.aliases].map(normalize)
  return facts.find((fact) => {
    const factName = normalize(fact.key + " " + fact.label)
    return aliases.some((alias) => alias && (factName.includes(alias) || alias.includes(factName)))
  })
}

// Produces the stable first-pass questionnaire. Facts from vision/CSV/model
// are preserved as known data; every missing factory-critical layer remains an
// explicit question with human-readable examples.
export function buildLayeredRequirements({ garmentType, seed = {}, modelFields = [] } = {}) {
  const templates = garmentTemplates(garmentType)
  const facts = factsFrom(seed, modelFields)
  const covered = new Set()
  const layers = templates.map((template) => {
    const fact = matchingFact(template, facts)
    if (fact) covered.add(fact)
    return {
      key: template.key,
      label: template.label,
      category: "general",
      layer: template.layer,
      example: template.example,
      status: fact ? KNOWN : ASK,
      value: fact ? fact.value : "",
      options: template.options,
      why: template.why,
    }
  })
  const evidence = facts
    .filter((fact) => !covered.has(fact))
    .map((fact, index) => ({
      key: "observed_" + normalize(fact.key || fact.label).replace(/ /g, "_").slice(0, 36) + "_" + index,
      label: fact.label || fact.key,
      category: "general",
      layer: "Evidencia recibida",
      example: "Dato detectado o aportado; confirmar si debe cambiar.",
      status: KNOWN,
      value: fact.value,
      options: [],
      why: "conserva evidencia sin sustituir capas obligatorias",
    }))
  return { garmentType: garmentType || "Prenda", fields: [...layers, ...evidence] }
}

export function requiredLayers(garmentType) {
  return [...new Set(garmentTemplates(garmentType).map((template) => template.layer))]
}

// Splices the model's genuinely NEW general "ask" questions on top of the
// layered floor - the garment-specific depth ("¿el puño lleva cordón
// interno?") that a fixed template can never anticipate. The floor is still
// the only thing that GUARANTEES coverage; this only ADDS, never replaces or
// removes a layer question, and skips anything that already overlaps a layer
// by key/label/alias so the same datum is never asked twice.
export function mergeAdditionalGeneralAsk({ garmentType, layeredFields, modelFields = [], max = 6 } = {}) {
  const templates = garmentTemplates(garmentType)
  const existingKeys = new Set((layeredFields || []).map((f) => normalize(f.key)))
  const existingLabels = (layeredFields || []).map((f) => normalize(f.label)).filter(Boolean)
  const templateAliasSets = templates.map((t) => new Set([t.key, t.label, ...t.aliases].map(normalize)))

  function overlapsExisting(candidate) {
    const key = normalize(candidate.key)
    const label = normalize(candidate.label)
    if (existingKeys.has(key)) return true
    if (existingLabels.some((existing) => existing.length > 2 && label.length > 2 && (existing.includes(label) || label.includes(existing)))) return true
    return templateAliasSets.some((aliases) => aliases.has(key) || (label && aliases.has(label)))
  }

  const seen = new Set()
  const extra = []
  for (const candidate of modelFields || []) {
    if (!candidate || candidate.category !== "general" || candidate.status !== ASK) continue
    if (typeof candidate.key !== "string" || !candidate.key.trim()) continue
    if (overlapsExisting(candidate)) continue
    const dedupeKey = normalize(candidate.key)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const options = Array.isArray(candidate.options) ? candidate.options.filter((o) => typeof o === "string" && o.trim()) : []
    extra.push({
      key: candidate.key.trim(),
      label: candidate.label || candidate.key,
      category: "general",
      layer: "Especifico de esta prenda",
      example: "",
      status: ASK,
      value: "",
      options: options.length >= 2 ? options.slice(0, 4) : ["Sí", "No"],
      why: candidate.why || "detalle propio de esta prenda, no cubierto por la guia estandar",
    })
    if (extra.length >= max) break
  }
  return extra
}
