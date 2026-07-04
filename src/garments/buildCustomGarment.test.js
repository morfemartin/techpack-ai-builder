import { describe, it, expect } from "vitest"
import { buildCustomGarment, mapChatDesignsToDesigns } from "./buildCustomGarment.js"

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
      designs: [{ name: "Logo", pos: "Pecho izquierdo", tec: "Bordado 3D", driveLink: "" }],
      notes: "Un bordado en el pecho, PANTONE 286 C",
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

  it("degrades gracefully on the old draft shape (designs as a string, no notes)", () => {
    const g = buildCustomGarment({ label: "Test", parts: [], positions: [], designs: "resumen viejo" })
    expect(g.designNotes).toBe("")
  })
})

describe("mapChatDesignsToDesigns", () => {
  it("falls back to one blank design at the fallback position when the chat drafted none", () => {
    expect(mapChatDesignsToDesigns([], "Toda la prenda")).toEqual([{ pos: "Toda la prenda" }])
    expect(mapChatDesignsToDesigns(undefined, "Toda la prenda")).toEqual([{ pos: "Toda la prenda" }])
  })

  it("maps drafted designs to the newDesign()-mergeable shape with sane defaults", () => {
    const result = mapChatDesignsToDesigns(
      [{ name: "Botones", pos: "Frente", tec: "Bordado 3D", driveLink: "drive.google.com/xyz" }, { name: "Logo" }],
      "Toda la prenda"
    )
    expect(result[0]).toEqual({ name: "Botones", pos: "Frente", posDetail: "", tec: "Bordado 3D", driveLink: "drive.google.com/xyz" })
    expect(result[1]).toEqual({ name: "Logo", pos: "Toda la prenda", posDetail: "", tec: "Bordado 3D", driveLink: "" })
  })
})
