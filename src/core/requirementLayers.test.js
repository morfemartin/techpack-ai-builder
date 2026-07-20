import { describe, expect, it } from "vitest"
import { buildLayeredRequirements, mergeAdditionalGeneralAsk, requiredLayers } from "./requirementLayers.js"

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

describe("mergeAdditionalGeneralAsk (restoring AI depth on top of the floor)", () => {
  const layered = buildLayeredRequirements({ garmentType: "hoodie" })

  it("keeps a genuinely new garment-specific question the model surfaced", () => {
    const extra = mergeAdditionalGeneralAsk({
      garmentType: "hoodie",
      layeredFields: layered.fields,
      modelFields: [
        { key: "drawcord_tips", label: "Herrajes del cordón", category: "general", status: "ask", options: ["Metal", "Plástico"], why: "define acabado del cordón" },
      ],
    })
    expect(extra).toHaveLength(1)
    expect(extra[0]).toMatchObject({ key: "drawcord_tips", status: "ask", category: "general" })
  })

  it("drops a model field that overlaps an existing layer by key, label, or alias", () => {
    const extra = mergeAdditionalGeneralAsk({
      garmentType: "hoodie",
      layeredFields: layered.fields,
      modelFields: [
        { key: "fabric", label: "Otra etiqueta para tela", category: "general", status: "ask", options: ["A", "B"] }, // key overlap
        { key: "capucha_tipo", label: "Capucha", category: "general", status: "ask", options: ["A", "B"] }, // label overlap (alias "capucha")
      ],
    })
    expect(extra).toHaveLength(0)
  })

  it("ignores known/assumed model fields and design-category fields (only general asks are eligible)", () => {
    const extra = mergeAdditionalGeneralAsk({
      garmentType: "hoodie",
      layeredFields: layered.fields,
      modelFields: [
        { key: "known_thing", label: "Ya sabido", category: "general", status: "known", value: "x" },
        { key: "a_design", label: "Logo", category: "design", status: "ask", options: ["A", "B"] },
      ],
    })
    expect(extra).toHaveLength(0)
  })

  it("dedupes among the model's own fields and caps the total", () => {
    const modelFields = Array.from({ length: 10 }, (_, i) => ({ key: "extra_" + i, label: "Campo " + i, category: "general", status: "ask", options: ["A", "B"] }))
    modelFields.push({ key: "extra_0", label: "Duplicado", category: "general", status: "ask", options: ["A", "B"] })
    const extra = mergeAdditionalGeneralAsk({ garmentType: "hoodie", layeredFields: layered.fields, modelFields, max: 6 })
    expect(extra).toHaveLength(6)
    expect(new Set(extra.map((f) => f.key)).size).toBe(6)
  })

  it("falls back to a 2-option default when the model's ask field has fewer than 2 options", () => {
    const extra = mergeAdditionalGeneralAsk({
      garmentType: "hoodie",
      layeredFields: layered.fields,
      modelFields: [{ key: "loose_thread_policy", label: "Politica de hilos sueltos", category: "general", status: "ask", options: [] }],
    })
    expect(extra[0].options.length).toBeGreaterThanOrEqual(2)
  })
})
