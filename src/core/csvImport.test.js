import { describe, it, expect, vi, beforeEach } from "vitest"
import { importGarmentCSV, buildExampleCSV, matchImagesToDesigns } from "./csvImport.js"
import { capGarment } from "../garments/cap.js"

vi.mock("./deepseekClient.js", () => ({
  extractStructured: vi.fn(),
}))

import { extractStructured } from "./deepseekClient.js"

describe("csvImport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends the garment's known part labels, positions, and techniques in the extraction prompt", async () => {
    extractStructured.mockResolvedValue({ parts: [], designs: [] })
    await importGarmentCSV("some,csv,text", { garment: capGarment, lang: "ES", tecs: ["Bordado 3D", "Sublimacion"] })
    const call = extractStructured.mock.calls[0][0]
    expect(call.instructions).toContain("Estilo")
    expect(call.instructions).toContain("Toda la gorra")
    expect(call.instructions).toContain("Sublimacion")
    expect(call.content).toBe("some,csv,text")
  })

  it("overlays matched part labels onto the garment's canonical id/order", async () => {
    extractStructured.mockResolvedValue({
      parts: [
        { label: "Boton", val: "Boton Dorado Personalizado", on: true },
        { label: "estilo", val: "Gorra Snapback", on: true }, // case-insensitive match
      ],
      designs: [],
    })
    const { parts } = await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [] })
    expect(parts).toHaveLength(capGarment.defaultParts.length)
    expect(parts[0]).toEqual({ id: 1, val: "Gorra Snapback", on: true }) // Estilo = id 1
    const boton = parts.find((p) => p.id === 6) // Boton = id 6
    expect(boton).toEqual({ id: 6, val: "Boton Dorado Personalizado", on: true })
  })

  it("keeps unmatched CSV rows as custom parts instead of dropping them", async () => {
    extractStructured.mockResolvedValue({
      parts: [{ label: "Forro Interior Especial", val: "Malla transpirable", on: true }],
      designs: [],
    })
    const { parts } = await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [] })
    expect(parts).toHaveLength(capGarment.defaultParts.length + 1)
    const extra = parts[parts.length - 1]
    expect(extra.customName).toBe("Forro Interior Especial")
    expect(extra.val).toBe("Malla transpirable")
    expect(typeof extra.id).toBe("number")
  })

  it("falls back to defaults for parts the CSV didn't mention", async () => {
    extractStructured.mockResolvedValue({ parts: [{ label: "Estilo", val: "Custom", on: true }], designs: [] })
    const { parts } = await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [] })
    const panels = parts.find((p) => p.id === 3) // Paneles - not in the mocked AI response
    expect(panels.val).toBe(capGarment.defaultParts.find((p) => p.id === 3).val)
  })

  it("passes designs through as returned by the model", async () => {
    const designs = [{ name: "Logo", pos: "Panel Frontal", tec: "Bordado 3D", colors: [{ name: "Azul", hex: "#003DA5" }] }]
    extractStructured.mockResolvedValue({ parts: [], designs })
    const result = await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [] })
    expect(result.designs).toEqual(designs)
  })

  it("defaults to empty arrays if the model omits parts or designs", async () => {
    extractStructured.mockResolvedValue({})
    const result = await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [] })
    expect(result.parts).toHaveLength(capGarment.defaultParts.length)
    expect(result.designs).toEqual([])
  })

  it("asks for a Wilcom-style embroidery spec object with an exact-technique rule", async () => {
    extractStructured.mockResolvedValue({ parts: [], designs: [] })
    await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: ["Bordado 3D", "Sublimacion"] })
    const call = extractStructured.mock.calls[0][0]
    expect(call.instructions).toContain("stitches")
    expect(call.instructions).toContain("stopSeq")
    expect(call.instructions).toContain("DEBE ser exactamente uno de bordado")
  })

  it("only mentions uploaded image filenames in the prompt when imageFileNames is given", async () => {
    extractStructured.mockResolvedValue({ parts: [], designs: [] })
    await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [], imageFileNames: ["logo_frontal.png"] })
    const withImages = extractStructured.mock.calls[0][0]
    expect(withImages.instructions).toContain("logo_frontal.png")
    expect(withImages.instructions).toContain("imageHint")

    vi.clearAllMocks()
    extractStructured.mockResolvedValue({ parts: [], designs: [] })
    await importGarmentCSV("csv", { garment: capGarment, lang: "ES", tecs: [] })
    const withoutImages = extractStructured.mock.calls[0][0]
    expect(withoutImages.instructions).not.toContain("imageHint")
  })
})

describe("matchImagesToDesigns", () => {
  const img = (fileName) => ({ fileName, imageData: "data-" + fileName, imageType: "png", imgNatW: 100, imgNatH: 100 })

  it("matches by imageHint case-insensitively", () => {
    const designs = [{ name: "Botones", imageHint: "Boton_Dorado.PNG" }]
    const { designs: result, unmatchedImages } = matchImagesToDesigns(designs, [img("boton_dorado.png")])
    expect(result[0].imageData).toBe("data-boton_dorado.png")
    expect(unmatchedImages).toEqual([])
  })

  it("falls back to pairing leftover images and imageless designs by order", () => {
    const designs = [{ name: "Logo Frontal" }, { name: "Logo Trasero" }]
    const { designs: result, unmatchedImages } = matchImagesToDesigns(designs, [img("a.png"), img("b.png")])
    expect(result[0].imageData).toBe("data-a.png")
    expect(result[1].imageData).toBe("data-b.png")
    expect(unmatchedImages).toEqual([])
  })

  it("reports leftover images that couldn't be matched instead of dropping them", () => {
    const designs = [{ name: "Logo Frontal" }]
    const { unmatchedImages } = matchImagesToDesigns(designs, [img("a.png"), img("b.png")])
    expect(unmatchedImages).toEqual([img("b.png")])
  })

  it("does not throw when there are images but no designs", () => {
    const { designs: result, unmatchedImages } = matchImagesToDesigns([], [img("a.png")])
    expect(result).toEqual([])
    expect(unmatchedImages).toEqual([img("a.png")])
  })
})

describe("buildExampleCSV", () => {
  it("produces a header row plus sample pieza/diseno rows", () => {
    const csv = buildExampleCSV(capGarment, "ES")
    const lines = csv.split("\n")
    expect(lines[0]).toBe("tipo,etiqueta,valor,posicion,tecnica,pantone,hex,ancho_mm,alto_mm")
    expect(lines.some((l) => l.startsWith("pieza,Estilo,"))).toBe(true)
    expect(lines.some((l) => l.startsWith("diseno,"))).toBe(true)
  })
})
