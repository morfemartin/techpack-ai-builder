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
