import { describe, it, expect, vi, beforeEach } from "vitest"
import { importGarmentCSV, buildExampleCSV } from "./csvImport.js"
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
