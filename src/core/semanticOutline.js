import { hasColorData } from "./colorSpecs.js"
import { hasSizeChartData } from "./sizeChart.js"

// Each system is a family of related parts. Its title used to be a fixed
// string sized for a technical parka - so a plain t-shirt whose only neck part
// is a crew collar still got a page headed "Capucha y cuello", and its sleeve
// got "Mangas, sisas y punos", naming a hood, armholes and cuffs it does not
// have. The fix: a system declares ASPECTS (a label + the tokens that signal
// it), and a page names only the aspects its actual parts trigger. `tokens`
// is the union, still used for classification.
const SYSTEMS = [
  {
    id: "shell-body",
    theme: "Cuerpo exterior y sellado",
    aspects: [
      { label: "Cuerpo", tokens: ["shell", "body", "front", "back", "yoke", "side", "cuerpo", "frente", "espalda", "canesu"] },
      { label: "Sellado de costuras", tokens: ["seam", "tape", "costura", "sellad"] },
    ],
    views: ["Frente exterior", "Espalda exterior"],
    mustMark: ["uniones de panel", "sentido de hilo", "recorrido de cinta de sellado"],
    factoryNote: "Relacionar cada llamada con el numero de pieza del BOM; no inferir tolerancias.",
  },
  {
    id: "hood-neck",
    theme: "Cuello y capucha",
    aspects: [
      { label: "Cuello", tokens: ["collar", "neck", "cuello", "escote", "neckline"] },
      { label: "Capucha", tokens: ["hood", "visor", "brim", "capucha", "visera"] },
    ],
    views: ["Cuello / escote", "Detalle de union al escote"],
    mustMark: ["piezas de cuello", "union al escote"],
    factoryNote: "Mostrar capas y puntos de anclaje sin asumir el metodo de montaje pendiente.",
  },
  {
    id: "sleeves-cuffs",
    theme: "Mangas",
    aspects: [
      { label: "Manga", tokens: ["sleeve", "manga", "armhole", "underarm", "sisa", "axila", "elbow", "codo"] },
      { label: "Puno", tokens: ["cuff", "puno", "puño"] },
    ],
    views: ["Manga exterior", "Detalle de terminacion"],
    mustMark: ["costura superior e inferior", "forma de codo", "sistema de ajuste"],
    factoryNote: "Mantener correspondencia izquierda/derecha y marcar piezas espejo.",
  },
  {
    id: "closures-pockets",
    theme: "Cierres y bolsillos",
    aspects: [
      { label: "Cierre", tokens: ["zip", "closure", "flap", "garage", "cierre", "cremallera", "tapeta", "cartera", "boton", "button"] },
      { label: "Bolsillos", tokens: ["pocket", "welt", "bolsillo"] },
    ],
    views: ["Frente funcional", "Detalles de acceso"],
    mustMark: ["inicio y fin de cierres", "aberturas utiles", "capas de tapeta y bolsa"],
    factoryNote: "Dibujar la relacion entre shell, cierre y bolsa; usar solo cotas confirmadas.",
  },
  {
    id: "lining-insulation",
    theme: "Interior y forro",
    aspects: [
      { label: "Forro", tokens: ["lining", "liner", "forro", "interior", "malla"] },
      { label: "Aislante", tokens: ["insulation", "fleece", "aislante", "polar"] },
    ],
    views: ["Interior abierto", "Union shell-forro"],
    mustMark: ["paneles interiores", "accesos de montaje", "puntos de union al shell"],
    factoryNote: "Separar graficamente material exterior, aislante y forro.",
  },
  {
    id: "trims-labels",
    theme: "Ajustes y rotulos",
    aspects: [
      { label: "Herrajes y ajustes", tokens: ["cord", "toggle", "elastic", "snap", "reflect", "trim", "cordon", "cordón", "tope", "elastico", "elástico", "broche", "ribete", "herra"] },
      { label: "Etiquetas", tokens: ["label", "tape", "etiqueta"] },
    ],
    views: ["Mapa de accesorios", "Rotulos y acabados"],
    mustMark: ["ubicacion de cada accesorio", "puntos de fijacion", "orientacion de etiquetas"],
    factoryNote: "Identificar cada accesorio con su numero de BOM y acabado confirmado.",
  },
].map((system, index) => ({
  ...system,
  number: index + 1,
  tokens: system.aspects.flatMap((aspect) => aspect.tokens),
}))

const SYSTEM_BY_ID = new Map(SYSTEMS.map((system) => [system.id, system]))

// The 6 SYSTEMS above are all CONSTRUCTION systems - but a real tech pack
// also carries data that isn't a piece of the garment at all: a size chart,
// stitches-per-inch specs, a QC checklist, factory notes, quantities. None
// of that has a token in SYSTEMS, so classifyPartSystem's old unconditional
// `SYSTEMS[0]` default dumped all of it into "Cuerpo exterior" - measured
// live on a real production document: 21 of 36 fields landed there. These
// give that data a home instead. `general` is the explicit, visible sink
// that replaces the silent SYSTEMS[0] fallback (see classifyPartBucket).
export const DATA_SECTIONS = [
  {
    id: "measurements",
    theme: "Medidas por talla",
    tokens: ["medida", "talle", "talla", "size", "fit", "calce", "tolerancia", "pulgada", "pecho", "ancho de hombro", "largo de cuerpo", "largo de manga", "apertura de cuello", "apertura de manga", "hem inferior"],
    objective: "Definir la tabla de medidas por talla y sus tolerancias.",
    criteria: "Todo dato expresado en cm/pulgadas o que varie por talla.",
    illustration: "optional",
    views: ["Puntos de medicion"],
  },
  {
    id: "materials",
    theme: "Materiales y consumos",
    // "fabric" deliberately excluded: it's a substring of the Spanish
    // "fabrica" (factory), which collided with factory-notes labels like
    // "Nombre de la fabrica" - caught by classifyPartBucket's own test.
    tokens: ["tela", "material", "composicion", "gramaje", "hilo", "forro tejido", "tejido", "gsm", "proveedor", "consumo", "bom"],
    objective: "Documentar telas, composicion y consumos de materiales.",
    criteria: "Todo dato de tela, composicion, gramaje, hilo o proveedor de materiales.",
    illustration: "optional",
  },
  {
    id: "stitching",
    theme: "Costuras y puntadas",
    tokens: ["puntada", "spi", "costura", "stitch", "seam", "overlock", "recubridora", "coverstitch", "doble aguja", "lockstitch"],
    objective: "Especificar tipo de costura, maquina y puntadas por pulgada.",
    criteria: "Todo dato de tipo de costura, maquina o densidad de puntada (SPI).",
    illustration: "optional",
    views: ["Detalle de costura"],
  },
  {
    id: "quality",
    theme: "Control de calidad",
    tokens: ["calidad", "control de calidad", "inspeccion", "defecto", "aql", "encogimiento", "checklist"],
    objective: "Listar los puntos de control de calidad antes de produccion en volumen.",
    criteria: "Todo checklist, tolerancia de encogimiento o requisito de inspeccion.",
    illustration: "none",
  },
  {
    id: "factory-notes",
    theme: "Notas de fabrica",
    tokens: ["fabrica", "produccion", "proceso", "operacion", "requisito", "fecha limite", "muestra fisica", "nota para la fabrica"],
    objective: "Comunicar requisitos y notas de proceso a la fabrica.",
    criteria: "Instrucciones de proceso, fechas o requisitos que no encajan en otra seccion tecnica.",
    illustration: "none",
  },
  {
    id: "labels-packaging",
    theme: "Etiquetas y empaque",
    tokens: ["etiqueta", "marquilla", "hangtag", "empaque", "packaging", "cuidado", "composicion y cuidado"],
    objective: "Especificar etiquetas, hangtag y empaque final.",
    criteria: "Todo dato de etiquetado, cuidado o empaque de la prenda terminada.",
    illustration: "optional",
    views: ["Ubicacion de etiquetas"],
  },
  {
    id: "quantities",
    theme: "Cantidades y curva",
    tokens: ["cantidad", "curva de talles", "pedido", "unidades", "moq", "ratio", "produccion total"],
    objective: "Definir cantidades por talla, color y pedido total.",
    criteria: "Todo dato de cantidades, curva de talles o unidades de pedido.",
    illustration: "none",
  },
  {
    id: "general",
    theme: "Datos generales",
    tokens: [],
    objective: "Reunir datos generales que no encajan en otra seccion.",
    criteria: "Cualquier dato que no matchee ninguna otra seccion.",
    illustration: "none",
    isSink: true,
  },
].map((section) => ({ ...section, purpose: "data:" + section.id }))

const DATA_SECTION_BY_ID = new Map(DATA_SECTIONS.map((section) => [section.id, section]))

// What classifyPartSystem/classifyPartBucket actually score against: every
// construction system plus every non-sink data section, same {id, tokens}
// shape so a part is judged against BOTH families at once instead of
// SYSTEMS always winning by not having any competition.
const CLASSIFIABLE = [
  ...SYSTEMS.map((system) => ({ id: system.id, purpose: "structure:" + system.id, tokens: system.tokens })),
  ...DATA_SECTIONS.filter((section) => !section.isSink).map((section) => ({ id: section.id, purpose: section.purpose, tokens: section.tokens })),
]

// The aspects a specific set of parts actually triggers, in declaration order.
// Falls back to the first aspect so a page is never left unlabelled.
function presentAspects(system, parts) {
  const haystack = (Array.isArray(parts) ? parts : [])
    .map((part) => [part && part.id, part && part.label, part && part.val].map(clean).join(" "))
    .join(" ")
    .toLowerCase()
  const present = system.aspects.filter((aspect) => aspect.tokens.some((token) => haystack.includes(token)))
  return present.length > 0 ? present : [system.aspects[0]]
}

// A human list: "Cuello", "Cuello y capucha", "Cierre, tapeta y bolsillos".
function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || ""
  return labels.slice(0, -1).join(", ") + " y " + labels[labels.length - 1]
}

// Title from the aspects present, not the fixed system name. `Sistema NN` is
// kept as a stable production index; what follows names only what is there.
function systemTitle(system, parts) {
  return "Sistema " + String(system.number).padStart(2, "0") + " · " + joinLabels(presentAspects(system, parts).map((a) => a.label))
}

function systemGarmentPart(system, parts) {
  return joinLabels(presentAspects(system, parts).map((a) => a.label))
}

function clean(value) {
  return String(value == null ? "" : value).trim()
}

function slug(value, fallback) {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback
}

// A chat-built custom garment's part is {id, val, on} - the human name lives
// in a DIFFERENT object, garment.partLabels[lang][id] (buildCustomGarment.js),
// while a CSV-imported part instead carries `customName`. Neither reaches
// the planner or the classifier today, so both see raw values with no idea
// what they mean ("180-220 GSM" instead of "Gramaje"). This resolves the
// name once, at one boundary, the same discipline as documentPlan.js's
// "pieces are strings from here on" rule.
export function partDisplayLabel(part, partLabels) {
  if (!part) return ""
  if (clean(part.customName)) return clean(part.customName)
  const known = partLabels && part.id != null ? partLabels[part.id] : undefined
  if (clean(known)) return clean(known)
  if (clean(part.label)) return clean(part.label)
  return "Pieza " + clean(part.id)
}

// Returns `parts` with `.label` resolved via partDisplayLabel, so every
// downstream reader (the outline prompt, classifyPartSystem, the deterministic
// fallback) gets a real field name for free without each having to know about
// garment.partLabels/customName itself.
export function withPartLabels(parts, garment, lang = "ES") {
  const partLabels = garment && garment.partLabels ? garment.partLabels[lang] || garment.partLabels.ES : undefined
  return (Array.isArray(parts) ? parts : []).map((part) => ({ ...part, label: partDisplayLabel(part, partLabels) }))
}

// `fallback` used to be implicit - `let best = SYSTEMS[0]` meant "shell-body"
// silently, however clearly wrong that was for the part (see DATA_SECTIONS'
// comment for the measured impact). Keeping the default preserves every
// existing caller/test; new callers that want an honest "nothing matched"
// pass `{ fallback: null }`.
export function classifyPartSystem(part, { fallback = "shell-body" } = {}) {
  const explicit = clean(part && part.system).toLowerCase()
  if (SYSTEM_BY_ID.has(explicit)) return explicit
  const haystack = [part && part.id, part && part.label, part && part.customName, part && part.val].map(clean).join(" ").toLowerCase()
  let best = null
  let bestScore = 0
  for (const system of SYSTEMS) {
    const score = system.tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
    if (score > bestScore) {
      best = system
      bestScore = score
    }
  }
  return best ? best.id : fallback
}

// The real classifier: scores a part against BOTH construction systems and
// data sections, and returns `data:general` (never a silent shell-body
// guess) when nothing genuinely matches. This is what partitionPartsBySystem
// uses now - classifyPartSystem above stays for callers that only know
// about construction systems (explicit `part.system` values, mostly).
export function classifyPartBucket(part) {
  const explicit = clean(part && part.system).toLowerCase()
  if (SYSTEM_BY_ID.has(explicit)) return { bucket: explicit, purpose: "structure:" + explicit, score: Infinity }
  const haystack = [part && part.id, part && part.label, part && part.customName, part && part.val].map(clean).join(" ").toLowerCase()
  let best = null
  let bestScore = 0
  for (const candidate of CLASSIFIABLE) {
    const score = candidate.tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  if (!best) return { bucket: "general", purpose: "data:general", score: 0 }
  return { bucket: best.id, purpose: best.purpose, score: bestScore }
}

export function balancedChunks(items, size) {
  const values = Array.isArray(items) ? items : []
  const limit = Math.max(1, Math.floor(Number(size) || 1))
  const pageCount = Math.max(1, Math.ceil(values.length / limit))
  const baseSize = Math.floor(values.length / pageCount)
  const largerPages = values.length % pageCount
  const result = []
  let index = 0
  for (let page = 0; page < pageCount; page++) {
    const pageSize = baseSize + (page < largerPages ? 1 : 0)
    if (pageSize > 0) result.push(values.slice(index, index + pageSize))
    index += pageSize
  }
  return result
}

// Builds the pages for one DATA_SECTIONS entry (or the "general" sink),
// paginated the same way a construction system is - shared so the sink
// doesn't need its own bespoke page-shape.
function dataSectionPages(section, members, limit) {
  return balancedChunks(members, limit).map((pageParts, index, all) => {
    const suffix = all.length > 1 ? " · " + (index + 1) + "/" + all.length : ""
    return {
      id: "data-" + section.id + (all.length > 1 ? "-" + (index + 1) : ""),
      title: section.theme + suffix,
      purpose: section.purpose,
      system: section.id,
      objective: section.objective,
      criteria: section.criteria,
      pieces: pageParts.map((part) => clean(part.id)),
      views: section.views ? section.views.slice() : [],
      // Consumed by deterministicPageLayout's data: branch - a size-chart
      // page can want a measurement-points illustration, a QC checklist
      // never should. "none" means never, "optional" means only if this
      // page actually has views to show.
      illustration: section.illustration,
    }
  })
}

export function partitionPartsBySystem(parts, { maxPartsPerPage = 8 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxPartsPerPage) || 8))
  const active = (Array.isArray(parts) ? parts : []).filter((part) => part && part.on !== false && clean(part.id))
  const systemGroups = new Map(SYSTEMS.map((system) => [system.id, []]))
  const dataGroups = new Map(DATA_SECTIONS.filter((section) => !section.isSink).map((section) => [section.id, []]))
  const generalGroup = []

  active.forEach((part) => {
    const { bucket, purpose } = classifyPartBucket(part)
    if (purpose.startsWith("structure:")) systemGroups.get(bucket).push(part)
    else if (dataGroups.has(bucket)) dataGroups.get(bucket).push(part)
    else generalGroup.push(part)
  })

  const pages = []
  for (const system of SYSTEMS) {
    const members = systemGroups.get(system.id)
    balancedChunks(members, limit).forEach((pageParts, index, all) => {
      const suffix = all.length > 1 ? " · " + (index + 1) + "/" + all.length : ""
      // Title and garmentPart are derived from THIS page's parts, so a page
      // never names an aspect (capucha, puno, forro) its parts do not have.
      const garmentPart = systemGarmentPart(system, pageParts)
      pages.push({
        id: "structure-" + system.id + (all.length > 1 ? "-" + (index + 1) : ""),
        title: systemTitle(system, pageParts) + suffix,
        purpose: "structure:" + system.id,
        system: system.id,
        objective: "Documentar " + garmentPart.toLowerCase() + " como conjunto fabricable y dibujable.",
        pieces: pageParts.map((part) => clean(part.id)),
        views: system.views.slice(),
        briefs: system.views.map((view) => ({
          garmentPart,
          view,
          mustMark: system.mustMark.slice(),
          measurements: [],
          placementLandmark: "Relacionar llamadas con las piezas listadas en esta pagina",
          factoryNote: system.factoryNote,
        })),
      })
    })
  }
  for (const section of DATA_SECTIONS) {
    if (section.isSink) continue
    pages.push(...dataSectionPages(section, dataGroups.get(section.id), limit))
  }
  if (generalGroup.length > 0) {
    pages.push(...dataSectionPages(DATA_SECTION_BY_ID.get("general"), generalGroup, limit))
  }
  return pages
}

function designPages(designs) {
  return (Array.isArray(designs) ? designs : []).filter((design) => design && clean(design.name)).map((design, index) => ({
    id: "design-" + slug(design.name, String(index + 1)),
    title: "D" + (index + 1) + " · " + clean(design.name),
    purpose: "design:" + clean(design.name),
    objective: "Definir colocacion, tecnica, color y archivo del diseno D" + (index + 1) + ".",
    covers: [clean(design.name)],
    views: Array.isArray(design.views) && design.views.length ? design.views.slice(0, 4) : ["Colocacion"],
    briefs: Array.isArray(design.briefs) ? design.briefs : undefined,
  }))
}

export function buildSemanticOutline({ garmentType, parts, designs, maxPartsPerPage = 8 } = {}) {
  const structurePages = partitionPartsBySystem(parts, { maxPartsPerPage })
  return {
    pages: [
      {
        id: "cover",
        title: clean(garmentType) || "Illustration Handoff",
        purpose: "cover",
        objective: "Identificar el proyecto y navegar su indice tecnico.",
      },
      ...(structurePages.length ? structurePages : [{ id: "overview", title: "Estructura general", purpose: "overview", objective: "Documentar la construccion general de la prenda." }]),
      ...designPages(designs),
    ],
  }
}

function designForPage(page, context) {
  const purpose = clean(page && page.purpose)
  if (!purpose.startsWith("design:")) return null
  const name = purpose.slice("design:".length).toLowerCase()
  return (Array.isArray(context && context.designs) ? context.designs : []).find((design) => clean(design && design.name).toLowerCase() === name) || null
}

function designBriefs(page, design) {
  if (Array.isArray(page.briefs) && page.briefs.length) return page.briefs
  const views = Array.isArray(page.views) && page.views.length ? page.views : ["Colocacion"]
  return views.map((view) => ({
    garmentPart: clean(design && design.pos) || "Aplicacion grafica",
    view,
    mustMark: ["limite del arte", "eje de centrado", "referencia de colocacion"],
    // No raw w/h measurement built here anymore - it duplicated (with worse
    // formatting: no unit conversion, no unit suffix) what briefs.js's own
    // defaultMeasurements already derives from design.w/h via
    // formatDimensions(). Leaving this empty lets that single, properly
    // converted dimension line be the only one, for both this deterministic
    // path and the AI-planned one.
    measurements: [],
    placementLandmark: clean(design && design.posDetail),
    factoryNote: clean(design && design.tec),
  }))
}

export function deterministicPageLayout(page, context = {}) {
  const purpose = clean(page && page.purpose)
  const chrome = [{ type: "header" }, { type: "titleBar" }]
  if (purpose === "cover") {
    return { ...page, regions: [...chrome, { type: "illustration", slots: 1, refs: ["Vista general del producto"] }, { type: "disclaimer" }] }
  }
  if (purpose.startsWith("design:")) {
    const design = designForPage(page, context)
    const views = Array.isArray(page.views) && page.views.length ? page.views : ["Colocacion"]
    const data = []
    if (design && Array.isArray(design.colors) && design.colors.some(hasColorData)) data.push({ type: "colorSpecs" })
    if (design && design.emb && Object.values(design.emb).some((value) => Array.isArray(value) ? value.length : clean(value))) data.push({ type: "embSpecs" })
    return {
      ...page,
      regions: [...chrome, ...data, { type: "illustration", slots: views.length, refs: views, briefs: designBriefs(page, design) }, { type: "disclaimer" }],
    }
  }
  if (purpose.startsWith("data:")) {
    if (purpose === "data:colorways") {
      return { ...page, regions: [...chrome, { type: "colorSpecs" }, { type: "disclaimer" }] }
    }
    // Gated on real chart data (never on the purpose string alone) - a
    // data:measurements page with no POMs filled in falls straight through
    // to the generic partsList branch below, byte-identical to before this
    // feature existed. See pageContracts.js's contractForPage for the same
    // gate on the contract side.
    if (purpose === "data:measurements" && hasSizeChartData(context && context.sizeChart)) {
      return { ...page, regions: [...chrome, { type: "sizeChart" }, { type: "disclaimer" }] }
    }
    // The table is the protagonist here (size chart, QC checklist, factory
    // notes) - an illustration is included only when the section actually
    // asked for one (page.illustration, set by dataSectionPages above) AND
    // there are real views to show it. "none" or no views -> table only.
    const views = Array.isArray(page.views) ? page.views : []
    const wantsIllustration = page.illustration === "optional" && views.length > 0
    return {
      ...page,
      regions: [
        ...chrome,
        { type: "partsList" },
        ...(wantsIllustration ? [{ type: "illustration", slots: views.length, refs: views, briefs: page.briefs || [] }] : []),
        { type: "disclaimer" },
      ],
    }
  }
  const views = Array.isArray(page.views) && page.views.length ? page.views : ["Vista tecnica"]
  return {
    ...page,
    regions: [...chrome, { type: "partsList" }, { type: "illustration", slots: views.length, refs: views, briefs: page.briefs || [] }, { type: "disclaimer" }],
  }
}

export function buildSemanticDocumentPlan(context = {}, options = {}) {
  const outline = buildSemanticOutline({
    garmentType: context.garmentType || (context.hdr && context.hdr.pname),
    parts: context.parts,
    designs: context.designs,
    maxPartsPerPage: options.maxPartsPerPage,
  })
  return { pages: outline.pages.map((page) => deterministicPageLayout(page, context)) }
}

export function auditSemanticCoverage(plan, parts) {
  const activeIds = (Array.isArray(parts) ? parts : []).filter((part) => part && part.on !== false && clean(part.id)).map((part) => clean(part.id))
  const counts = new Map(activeIds.map((id) => [id, 0]))
  for (const page of (plan && plan.pages) || []) {
    const purpose = clean(page && page.purpose)
    // data:* pages (DATA_SECTIONS) hold real BOM coverage now too - a size
    // chart or a QC checklist page is exactly as "covering" its pieces as a
    // structure:* page is. Missing this would report every part correctly
    // routed to a data section as falsely "missing".
    if (!(purpose === "overview" || purpose === "lining" || purpose.startsWith("structure:") || purpose.startsWith("data:"))) continue
    for (const id of Array.isArray(page.pieces) ? page.pieces : []) {
      if (counts.has(clean(id))) counts.set(clean(id), counts.get(clean(id)) + 1)
    }
  }
  return {
    covered: [...counts].filter(([, count]) => count === 1).map(([id]) => id),
    missing: [...counts].filter(([, count]) => count === 0).map(([id]) => id),
    duplicated: [...counts].filter(([, count]) => count > 1).map(([id]) => id),
  }
}

// Signal, not silence: if the "general" sink is absorbing a big chunk of the
// document, that means DATA_SECTIONS' taxonomy is missing a real category -
// worth a plan warning so it gets fixed, not quietly tolerated forever.
export function auditSinkOverflow(pages, threshold = 8) {
  const sinkPages = (Array.isArray(pages) ? pages : []).filter((page) => clean(page && page.purpose) === "data:general")
  const count = sinkPages.reduce((total, page) => total + (Array.isArray(page.pieces) ? page.pieces.length : 0), 0)
  return { count, overflowing: count > threshold }
}
