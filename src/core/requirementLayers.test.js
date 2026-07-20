import { describe, expect, it } from "vitest"
import { buildLayeredRequirements, requiredLayers } from "./requirementLayers.js"

describe("layered intake contract", () => {
  it("covers every factory-critical layer with understandable questions and examples", () => {
    const result = buildLayeredRequirements({ garmentType: "Polo de golf" })
    const asks = result.fields.filter((field) => field.status === "ask")

    expect(new Set(asks.map((field) => field.layer))).toEqual(new Set(requiredLayers("Polo de golf")))
    expect(asks).toHaveLength(12)
    expect(asks.every((field) => field.label && field.example.startsWith("Ej.:") && field.options.length >= 2)).toBe(true)
    expect(asks.map((field) => field.key)).toEqual(expect.arrayContaining(["fabric", "fit", "size_range", "collar", "sleeve", "placket", "production_notes", "applications"]))
  })

  it("maps evidence into the canonical question without skipping the other layers", () => {
    const result = buildLayeredRequirements({
      garmentType: "hoodie",
      seed: { "Tela principal": "French terry gris 320 g/m2", "Capucha": "Doble tela con cordon" },
    })

    expect(result.fields.find((field) => field.key === "fabric")).toMatchObject({ status: "known", value: "French terry gris 320 g/m2" })
    expect(result.fields.find((field) => field.key === "hood")).toMatchObject({ status: "known", value: "Doble tela con cordon" })
    expect(result.fields.find((field) => field.key === "fit").status).toBe("ask")
    expect(result.fields.find((field) => field.key === "size_range").status).toBe("ask")
  })

  it("preserves non-contract evidence instead of silently discarding it", () => {
    const result = buildLayeredRequirements({ garmentType: "polo", seed: { Color: "Azul marino", Referencia: "foto frontal" } })
    const evidence = result.fields.filter((field) => field.layer === "Evidencia recibida")

    expect(evidence.map((field) => [field.label, field.value])).toEqual(expect.arrayContaining([
      ["Color", "Azul marino"],
      ["Referencia", "foto frontal"],
    ]))
  })
})
