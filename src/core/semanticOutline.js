const SYSTEMS = [
  {
    id: "shell-body",
    title: "Sistema 01 · Cuerpo exterior y sellado",
    tokens: ["shell", "body", "front", "back", "yoke", "side", "seam", "tape", "cuerpo", "frente", "espalda", "canesu", "costura", "sellad"],
    views: ["Frente exterior", "Espalda exterior"],
    garmentPart: "Cuerpo exterior",
    mustMark: ["uniones de panel", "sentido de hilo", "recorrido de cinta de sellado"],
    factoryNote: "Relacionar cada llamada con el numero de pieza del BOM; no inferir tolerancias.",
  },
  {
    id: "hood-neck",
    title: "Sistema 02 · Capucha y cuello",
    tokens: ["hood", "collar", "neck", "visor", "brim", "capucha", "cuello", "visera"],
    views: ["Capucha exterior", "Capucha interior abierta"],
    garmentPart: "Capucha y cuello",
    mustMark: ["piezas de capucha", "canal de ajuste", "union al escote"],
    factoryNote: "Mostrar capas y puntos de anclaje sin asumir el metodo de montaje pendiente.",
  },
  {
    id: "sleeves-cuffs",
    title: "Sistema 03 · Mangas, sisas y punos",
    tokens: ["sleeve", "cuff", "elbow", "underarm", "armhole", "manga", "puno", "puño", "codo", "sisa", "axila"],
    views: ["Manga exterior", "Puno y ajuste"],
    garmentPart: "Mangas y punos",
    mustMark: ["costura superior e inferior", "forma de codo", "sistema de ajuste"],
    factoryNote: "Mantener correspondencia izquierda/derecha y marcar piezas espejo.",
  },
  {
    id: "closures-pockets",
    title: "Sistema 04 · Cierres, tapetas y bolsillos",
    tokens: ["zip", "closure", "flap", "pocket", "welt", "garage", "cierre", "cremallera", "tapeta", "bolsillo", "cartera"],
    views: ["Frente funcional", "Detalles de acceso"],
    garmentPart: "Cierres y bolsillos",
    mustMark: ["inicio y fin de cierres", "aberturas utiles", "capas de tapeta y bolsa"],
    factoryNote: "Dibujar la relacion entre shell, cierre y bolsa; usar solo cotas confirmadas.",
  },
  {
    id: "lining-insulation",
    title: "Sistema 05 · Forro, aislante e interior",
    tokens: ["lining", "liner", "insulation", "fleece", "interior", "forro", "aislante", "polar", "malla"],
    views: ["Interior abierto", "Union shell-forro"],
    garmentPart: "Interior y forro",
    mustMark: ["paneles interiores", "accesos de montaje", "puntos de union al shell"],
    factoryNote: "Separar graficamente material exterior, aislante y forro.",
  },
  {
    id: "trims-labels",
    title: "Sistema 06 · Ajustes, herrajes y rotulos",
    tokens: ["cord", "toggle", "elastic", "snap", "label", "tape", "reflect", "trim", "cordon", "cordón", "tope", "elastico", "elástico", "broche", "etiqueta", "ribete", "herra"],
    views: ["Mapa de accesorios", "Rotulos y acabados"],
    garmentPart: "Accesorios y acabados",
    mustMark: ["ubicacion de cada accesorio", "puntos de fijacion", "orientacion de etiquetas"],
    factoryNote: "Identificar cada accesorio con su numero de BOM y acabado confirmado.",
  },
]

const SYSTEM_BY_ID = new Map(SYSTEMS.map((system) => [system.id, system]))

function clean(value) {
  return String(value == null ? "" : value).trim()
}

function slug(value, fallback) {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback
}

export function classifyPartSystem(part) {
  const explicit = clean(part && part.system).toLowerCase()
  if (SYSTEM_BY_ID.has(explicit)) return explicit
  const haystack = [part && part.id, part && part.label, part && part.val].map(clean).join(" ").toLowerCase()
  let best = SYSTEMS[0]
  let bestScore = 0
  for (const system of SYSTEMS) {
    const score = system.tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
    if (score > bestScore) {
      best = system
      bestScore = score
    }
  }
  return best.id
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

export function partitionPartsBySystem(parts, { maxPartsPerPage = 8 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxPartsPerPage) || 8))
  const active = (Array.isArray(parts) ? parts : []).filter((part) => part && part.on !== false && clean(part.id))
  const groups = new Map(SYSTEMS.map((system) => [system.id, []]))
  active.forEach((part) => groups.get(classifyPartSystem(part)).push(part))

  const pages = []
  for (const system of SYSTEMS) {
    const members = groups.get(system.id)
    balancedChunks(members, limit).forEach((pageParts, index, all) => {
      const suffix = all.length > 1 ? " · " + (index + 1) + "/" + all.length : ""
      pages.push({
        id: "structure-" + system.id + (all.length > 1 ? "-" + (index + 1) : ""),
        title: system.title + suffix,
        purpose: "structure:" + system.id,
        system: system.id,
        objective: "Documentar " + system.garmentPart.toLowerCase() + " como conjunto fabricable y dibujable.",
        pieces: pageParts.map((part) => clean(part.id)),
        views: system.views.slice(),
        briefs: system.views.map((view) => ({
          garmentPart: system.garmentPart,
          view,
          mustMark: system.mustMark.slice(),
          measurements: [],
          placementLandmark: "Relacionar llamadas con las piezas listadas en esta pagina",
          factoryNote: system.factoryNote,
        })),
      })
    })
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
    views: Array.isArray(design.views) && design.views.length ? design.views.slice(0, 4) : ["Colocacion", "Detalle de ejecucion"],
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
    measurements: design && design.w && design.h ? [{ label: "Ancho " + design.w + " x alto " + design.h, perSize: false }] : [],
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
    if (design && Array.isArray(design.colors) && design.colors.some((color) => color && color.hex)) data.push({ type: "colorSpecs" })
    if (design && design.emb && Object.values(design.emb).some((value) => Array.isArray(value) ? value.length : clean(value))) data.push({ type: "embSpecs" })
    return {
      ...page,
      regions: [...chrome, ...data, { type: "illustration", slots: views.length, refs: views, briefs: designBriefs(page, design) }, { type: "disclaimer" }],
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
    if (!(purpose === "overview" || purpose === "lining" || purpose.startsWith("structure:"))) continue
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
