import { describe, it, expect } from "vitest"
import { buildCustomGarment } from "./buildCustomGarment.js"

describe("buildCustomGarment", () => {
  it("builds the same shape a registered garment has, minus guides/callouts", () => {
    const draft = {
      id: "polo",
      label: "Polo Clasico",
      parts: [
        { label: "Botones", val: "3, nacar" },
        { label: "Cola de pato", val: "Si" },
      ],
      positions: ["Pecho izquierdo", "Manga"],
      designs: "Un bordado en el pecho, PANTONE 286 C",
    }
    const g = buildCustomGarment(draft)

    expect(g.id).toBe("custom-polo")
    expect(g.label).toEqual({ ES: "Polo Clasico" })
    expect(g.defaultParts).toEqual([
      { id: 1, val: "3, nacar", on: true },
      { id: 2, val: "Si", on: true },
    ])
    expect(g.partLabels.ES).toEqual({ 1: "Botones", 2: "Cola de pato" })
    expect(g.positions.ES).toEqual(["Pecho izquierdo", "Manga"])
    expect(g.guides).toBeUndefined()
    expect(g.callouts).toBeUndefined()
    expect(g.designNotes).toBe("Un bordado en el pecho, PANTONE 286 C")
  })

  it("slugifies an accented / spaced label into the id", () => {
    const g = buildCustomGarment({ label: "Camisón Básico", parts: [], positions: [] })
    expect(g.id).toBe("custom-camison-basico")
  })

  it("falls back to a default position when the chat didn't provide any", () => {
    const g = buildCustomGarment({ label: "Test", parts: [], positions: [] })
    expect(g.positions.ES).toEqual(["Toda la prenda"])
  })

  it("handles a missing/empty parts array without throwing", () => {
    const g = buildCustomGarment({ label: "Test" })
    expect(g.defaultParts).toEqual([])
    expect(g.partLabels.ES).toEqual({})
  })
})
