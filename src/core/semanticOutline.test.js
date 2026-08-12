import { describe, expect, it } from "vitest"
import { alpineParkaBenchmark } from "../layoutLab/benchmarkProject.js"
import { auditSemanticCoverage, auditSinkOverflow, balancedChunks, buildSemanticDocumentPlan, buildSemanticOutline, classifyPartBucket, classifyPartSystem, deterministicPageLayout, partDisplayLabel, partitionPartsBySystem, withPartLabels } from "./semanticOutline.js"
import { newPom, newSizeChart } from "./sizeChart.js"

const context = { ...alpineParkaBenchmark, garmentType: alpineParkaBenchmark.label }

describe("semantic document architecture", () => {
  it("balances overflow instead of leaving a one-row continuation", () => {
    expect(balancedChunks([1, 2, 3, 4, 5, 6, 7, 8, 9], 8).map((page) => page.length)).toEqual([5, 4])
    expect(balancedChunks(Array.from({ length: 17 }), 8).map((page) => page.length)).toEqual([6, 6, 5])
  })

  it("uses explicit systems before token inference and has a deterministic fallback", () => {
    expect(classifyPartSystem({ id: "zip", system: "hood-neck" })).toBe("hood-neck")
    expect(classifyPartSystem({ id: "cargo-pocket" })).toBe("closures-pockets")
    expect(classifyPartSystem({ id: "unknown-component" })).toBe("shell-body")
  })

  it("partitions all 40 active pieces exactly once with a bounded page load", () => {
    const pages = partitionPartsBySystem(context.parts, { maxPartsPerPage: 8 })
    const ids = pages.flatMap((page) => page.pieces)
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
    expect(pages.every((page) => page.pieces.length <= 8)).toBe(true)
    expect(pages.map((page) => page.system)).toEqual([
      "shell-body",
      "hood-neck",
      "sleeves-cuffs",
      "closures-pockets",
      "lining-insulation",
      "trims-labels",
    ])
  })

  it("builds cover, six construction objectives and one page per design", () => {
    const outline = buildSemanticOutline(context)
    expect(outline.pages).toHaveLength(10)
    expect(outline.pages[0].purpose).toBe("cover")
    expect(outline.pages.filter((page) => page.purpose.startsWith("structure:"))).toHaveLength(6)
    expect(outline.pages.filter((page) => page.purpose.startsWith("design:"))).toHaveLength(3)
    expect(outline.pages.filter((page) => page.pieces).every((page) => page.objective && page.views.length === 2)).toBe(true)
  })

  it("creates a complete deterministic layout plan whose coverage audit is clean", () => {
    const plan = buildSemanticDocumentPlan(context)
    const audit = auditSemanticCoverage(plan, context.parts)
    expect(audit).toEqual({ covered: context.parts.map((part) => part.id), missing: [], duplicated: [] })
    for (const page of plan.pages.filter((item) => item.purpose.startsWith("structure:"))) {
      expect(page.regions.map((region) => region.type)).toEqual(["header", "titleBar", "partsList", "illustration", "disclaimer"])
      const illustration = page.regions.find((region) => region.type === "illustration")
      expect(illustration.briefs).toHaveLength(2)
      expect(illustration.briefs.every((brief) => brief.measurements.length === 0)).toBe(true)
    }
  })

  it("does not count a design placement reference as duplicate BOM coverage", () => {
    const plan = buildSemanticDocumentPlan(context)
    plan.pages.find((page) => page.purpose.startsWith("design:")).pieces = [context.parts[0].id]
    expect(auditSemanticCoverage(plan, context.parts).duplicated).toEqual([])
  })

  it("gives a design page ONE honest view by default, not two duplicate-content boxes", () => {
    // Used to default to ["Colocacion", "Detalle de ejecucion"] - two boxes
    // whose brief bodies are built from the same single design object, so
    // they said the exact same thing under two different titles. A design
    // with no explicit `views` (the common case: chat-built garments never
    // set one) must get exactly one honest box.
    const outline = buildSemanticOutline({
      garmentType: "Hoodie",
      parts: [],
      designs: [{ name: "Chest Logo" }],
    })
    const designPage = outline.pages.find((page) => page.purpose.startsWith("design:"))
    expect(designPage.views).toEqual(["Colocacion"])
  })

  it("still honors an explicit multi-view design instead of collapsing it", () => {
    const outline = buildSemanticOutline({
      garmentType: "Hoodie",
      parts: [],
      designs: [{ name: "Chest Logo", views: ["Frente", "Detalle bordado"] }],
    })
    const designPage = outline.pages.find((page) => page.purpose.startsWith("design:"))
    expect(designPage.views).toEqual(["Frente", "Detalle bordado"])
  })
})

describe("DATA_SECTIONS - real production fields no longer sink into shell-body", () => {
  // Field names transcribed from a real Arrive Aruba polo tech-pack doc.
  // Measured before this fix: 21 of 36 of these landed in shell-body because
  // classifyPartSystem's SYSTEMS[0] default silently absorbed anything with
  // no construction token - 9 near-identical "Cuerpo exterior" pages.
  const fields = [
    ["Tipo de prenda", "Polo manga corta"],
    ["Composicion", "91% Poliester / 9% Spandex"],
    ["Estructura de tejido", "Performance Pique Knit"],
    ["Gramaje", "180-220 GSM"],
    ["Fit", "Regular Classic"],
    ["Rango de tallas", "XS-XXL"],
    ["Talla base de muestra", "M"],
    ["Nombre de color", "Fair Green"],
    ["Pantone TCX", "15-6316 TCX"],
    ["HEX", "#92af88"],
    ["Tela principal", "91% Poliester / 9% Spandex Pique"],
    ["Cuello", "Acrilico 1mm"],
    ["Botones", "Poliester perlado con grabado de logo"],
    ["Cantidad de botones", "3 en placket + 1 de repuesto"],
    ["Hilo de costura", "Poliester tono sobre tono"],
    ["Hilo de bordado", "Madeira Classic Rayon 40 Color 1055"],
    ["Estabilizador", "Cutaway no-show mesh"],
    ["Etiqueta tejida", "Pendiente de definir"],
    ["Etiqueta de composicion", "Pendiente"],
    ["Altura del cuello", "3.5 cm"],
    ["Placket", "3 botones 14 cm de largo"],
    ["Medio pecho M", "54 cm"],
    ["Largo de cuerpo M", "72 cm"],
    ["Ancho de hombros M", "47 cm"],
    ["Largo de manga M", "24 cm"],
    ["Apertura de cuello M", "18 cm"],
    ["Costura de hombro SPI", "12"],
    ["Costuras laterales SPI", "12"],
    ["Placket SPI", "14"],
    ["Placement pecho izquierdo", "5.1-6.35 cm"],
    ["Pre-lavado", "No requerido"],
    ["Tolerancia de encogimiento", "maximo 3%"],
    ["Nombre de la fabrica", "A definir"],
    ["Fecha limite de entrega de ficha", "A confirmar"],
    ["Hangtag", "Pendiente"],
    ["Cantidad total de unidades", "A confirmar por Patrick"],
  ]
  const parts = fields.map(([label, val], i) => ({ id: i + 1, label, val, on: true }))

  it("spreads real production fields across at least 5 purposes, none holding more than a third", () => {
    const buckets = new Map()
    for (const part of parts) {
      const { purpose } = classifyPartBucket(part)
      buckets.set(purpose, (buckets.get(purpose) || 0) + 1)
    }
    expect(buckets.size).toBeGreaterThanOrEqual(5)
    for (const count of buckets.values()) expect(count).toBeLessThanOrEqual(Math.ceil(parts.length / 3))
  })

  it("routes non-construction fields to a data: page, not structure:shell-body", () => {
    const pages = partitionPartsBySystem(parts)
    const shellBody = pages.find((page) => page.purpose === "structure:shell-body")
    // Only genuinely construction-worded fields (Cuello, Botones, Placket...)
    // may land here - not gramaje, SPI, measurements, factory/QC/label data.
    const shellBodyCount = shellBody ? shellBody.pieces.length : 0
    expect(shellBodyCount).toBeLessThan(parts.length / 2)
    expect(pages.some((page) => page.purpose === "data:measurements")).toBe(true)
    expect(pages.some((page) => page.purpose === "data:stitching")).toBe(true)
    expect(pages.some((page) => page.purpose === "data:materials")).toBe(true)
  })

  it("keeps the general sink small enough not to trip the overflow audit", () => {
    const pages = partitionPartsBySystem(parts)
    expect(auditSinkOverflow(pages).overflowing).toBe(false)
  })
})

describe("auditSinkOverflow", () => {
  it("flags when data:general is absorbing more than the threshold", () => {
    const pages = [{ purpose: "data:general", pieces: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] }]
    expect(auditSinkOverflow(pages)).toEqual({ count: 9, overflowing: true })
  })

  it("does not flag a small or absent sink", () => {
    expect(auditSinkOverflow([{ purpose: "data:general", pieces: ["1"] }])).toEqual({ count: 1, overflowing: false })
    expect(auditSinkOverflow([])).toEqual({ count: 0, overflowing: false })
  })
})

describe("classifyPartBucket", () => {
  it("trusts an explicit part.system over any token match", () => {
    expect(classifyPartBucket({ id: "x", system: "hood-neck", val: "medida de tela" })).toEqual({ bucket: "hood-neck", purpose: "structure:hood-neck", score: Infinity })
  })

  it("returns the data:general sink, never a construction guess, when nothing matches", () => {
    expect(classifyPartBucket({ id: "x", label: "Referencia interna", val: "N/A" })).toEqual({ bucket: "general", purpose: "data:general", score: 0 })
  })

  it("classifies real data-section labels correctly", () => {
    expect(classifyPartBucket({ label: "Rango de tallas", val: "XS-XXL" }).purpose).toBe("data:measurements")
    expect(classifyPartBucket({ label: "Puntadas por pulgada", val: "12 SPI" }).purpose).toBe("data:stitching")
    expect(classifyPartBucket({ label: "Nombre de la fabrica", val: "A definir" }).purpose).toBe("data:factory-notes")
  })
})

describe("partDisplayLabel / withPartLabels", () => {
  // A chat-built custom garment's part is {id, val, on} - the human name
  // lives separately in garment.partLabels[lang][id], and the planner never
  // saw it (see documentPlan.js promptSafeParts) - it reasoned over bare
  // values like "180-220 GSM" with no idea that field is called "Gramaje".
  it("prefers customName, then partLabels[id], then part.label, then a numbered fallback", () => {
    expect(partDisplayLabel({ id: 4, customName: "Gramaje" }, { 4: "Otro nombre" })).toBe("Gramaje")
    expect(partDisplayLabel({ id: 4 }, { 4: "Gramaje" })).toBe("Gramaje")
    expect(partDisplayLabel({ id: 4, label: "Ya tenia label" }, undefined)).toBe("Ya tenia label")
    expect(partDisplayLabel({ id: 4 }, undefined)).toBe("Pieza 4")
  })

  it("resolves every part's label from the garment's partLabels for the given language", () => {
    const garment = { partLabels: { ES: { 1: "Tela principal", 2: "Rango de tallas" } } }
    const parts = [{ id: 1, val: "91% Poliester" }, { id: 2, val: "XS-XXL" }]
    expect(withPartLabels(parts, garment, "ES").map((p) => p.label)).toEqual(["Tela principal", "Rango de tallas"])
  })

  it("does not overwrite a part that already carries its own label", () => {
    const parts = [{ id: 1, val: "Nylon 40D 3L", label: "Frente izquierdo shell" }]
    expect(withPartLabels(parts, undefined, "ES")[0].label).toBe("Frente izquierdo shell")
  })
})

describe("system titles name only the aspects a page actually contains", () => {
  it("does not title a plain t-shirt's neck page 'Capucha y cuello'", () => {
    // A crew-neck tee has a collar and no hood - the page used to be headed
    // "Capucha y cuello" regardless, naming a hood the garment lacks.
    const pages = partitionPartsBySystem([
      { id: "tela", label: "Tela principal", val: "Jersey de algodon", on: true },
      { id: "cuello", label: "Cuello", val: "Redondo rib", on: true },
      { id: "manga", label: "Manga", val: "Corta", on: true },
    ])
    const titles = pages.map((p) => p.title)
    expect(titles.some((t) => /Cuello/.test(t) && !/Capucha/.test(t))).toBe(true)
    expect(titles.some((t) => /Capucha/.test(t))).toBe(false)
    // and the sleeve page does not invent cuffs/armholes
    expect(titles.some((t) => /puno|sisa/i.test(t))).toBe(false)
  })

  it("names capucha and puno when the parts actually have them", () => {
    const pages = partitionPartsBySystem([
      { id: "capucha", label: "Capucha", val: "Con visera", on: true },
      { id: "manga", label: "Manga", val: "Con puno rib", on: true },
    ])
    const titles = pages.map((p) => p.title).join(" | ")
    expect(titles).toMatch(/Capucha/)
    expect(titles).toMatch(/Puno/)
  })

  it("keeps the stable Sistema NN production index", () => {
    const pages = partitionPartsBySystem([{ id: "cuello", label: "Cuello", val: "Redondo", on: true }])
    expect(pages.every((p) => /^Sistema \d\d · /.test(p.title))).toBe(true)
  })
})

describe("deterministicPageLayout: data:measurements gated on real chart data", () => {
  const page = { id: "medidas", title: "Medidas", purpose: "data:measurements" }
  const chart = newSizeChart({ poms: [newPom({ label: "Medio pecho", values: { M: 54 } })] })

  it("draws sizeChart once the chart actually has POMs", () => {
    const layout = deterministicPageLayout(page, { sizeChart: chart })
    expect(layout.regions.map((r) => r.type)).toContain("sizeChart")
    expect(layout.regions.map((r) => r.type)).not.toContain("partsList")
  })

  it("falls through to the plain partsList branch with no chart - unchanged from before this feature", () => {
    const noChart = deterministicPageLayout(page, { sizeChart: newSizeChart() })
    const noCtx = deterministicPageLayout(page, {})
    expect(noChart.regions.map((r) => r.type)).toContain("partsList")
    expect(noChart.regions.map((r) => r.type)).not.toContain("sizeChart")
    expect(noCtx.regions).toEqual(noChart.regions)
  })
})
