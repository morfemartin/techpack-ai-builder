import { describe, expect, it } from "vitest"
import { applyMadeiraThread, madeiraColorsToStops, normalizeFabricColor, normalizeMadeiraThread, pantoneDisplay } from "./colorSpecs.js"

describe("technical color contracts", () => {
  it("keeps an unverified Pantone approximation distinct from the display hex", () => {
    const color = normalizeFabricColor({ name: "Azul", hex: "#123456", pantoneApprox: "19-4052 TCX" })
    expect(color).toMatchObject({ hex: "#123456", pantoneStatus: "approximate" })
    expect(pantoneDisplay(color)).toContain("NO VERIFICADO")
  })

  it("prints a pending Pantone instead of inventing one", () => {
    expect(pantoneDisplay({ name: "Azul", hex: "#123456" })).toBe("PANTONE: PENDIENTE DE VERIFICAR")
  })

  it("selects a Madeira code as one complete screen-reference record", () => {
    expect(normalizeMadeiraThread("1055")).toMatchObject({ code: "1055", name: "Latte", displayAccuracy: "screen-reference" })
    const selected = applyMadeiraThread({ name: "", hex: "#FFFFFF" }, "1055")
    expect(selected.name).toContain("1055 · Latte")
    expect(selected.hex).toMatch(/^#[0-9A-F]{6}$/)
  })

  it("synchronizes selected Madeira swatches with embroidery stops", () => {
    const selected = applyMadeiraThread({ name: "", hex: "#FFFFFF" }, "1055")
    const stops = madeiraColorsToStops([selected], [{ stitches: 4200, madeira: selected.madeira }])
    expect(stops[0]).toMatchObject({ stop: 1, code: "1055", name: "Latte", stitches: 4200, displayHex: selected.hex })
  })

  it("removes deselected catalogue stops without deleting custom threads", () => {
    const stops = madeiraColorsToStops([], [
      { stop: 1, code: "1055", madeira: normalizeMadeiraThread("1055") },
      { stop: 2, name: "Hilo metalico propio", color: "#AAAAAA", madeira: { custom: true } },
    ])
    expect(stops).toEqual([expect.objectContaining({ stop: 1, name: "Hilo metalico propio" })])
  })
})
