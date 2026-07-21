import { describe, expect, it } from "vitest"
import { buildLayeredRequirements, enrichLayersWithModel, mergeAdditionalGeneralAsk, requiredLayers } from "./requirementLayers.js"

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

describe("enrichLayersWithModel (garment-specific tailoring of the layers)", () => {
  const layered = buildLayeredRequirements({ garmentType: "Campera con capucha" })

  it("replaces a layer's generic options with the model's garment-specific ones", () => {
    // The whole point of the fix: a technical shell jacket must not be offered
    // "Algodon pique / Jersey algodon" just because the template says so.
    const { fields } = enrichLayersWithModel({
      garmentType: "Campera con capucha",
      layeredFields: layered.fields,
      modelFields: [{
        key: "fabric", label: "Tela principal (shell)", category: "general", status: "ask",
        options: ["Softshell 3 capas", "Nylon ripstop", "Membrana impermeable", "Polar tecnico"],
        why: "define impermeabilidad y transpirabilidad",
      }],
    })
    const fabric = fields.find((f) => f.key === "fabric")
    expect(fabric.options).toEqual(["Softshell 3 capas", "Nylon ripstop", "Membrana impermeable", "Polar tecnico"])
    expect(fabric.label).toBe("Tela principal (shell)")
    expect(fabric.why).toBe("define impermeabilidad y transpirabilidad")
    expect(fabric.tailored).toBe(true)
  })

  it("keeps the layer's identity so coverage and the walker still work", () => {
    const { fields } = enrichLayersWithModel({
      garmentType: "Campera con capucha",
      layeredFields: layered.fields,
      modelFields: [{ key: "fabric", label: "Otra cosa", category: "general", status: "ask", options: ["A", "B"] }],
    })
    const fabric = fields.find((f) => f.key === "fabric")
    expect(fabric.key).toBe("fabric")
    expect(fabric.status).toBe("ask")
    expect(fabric.layer).toBe("Materiales")
    expect(fields).toHaveLength(layered.fields.length)
  })

  it("never overwrites a layer already KNOWN from vision/CSV/seed evidence", () => {
    const withFact = buildLayeredRequirements({ garmentType: "Campera con capucha", seed: { "Tela principal": "Softshell confirmado" } })
    const { fields, consumedKeys } = enrichLayersWithModel({
      garmentType: "Campera con capucha",
      layeredFields: withFact.fields,
      modelFields: [{ key: "fabric", label: "Tela", category: "general", status: "ask", options: ["X", "Y"] }],
    })
    const fabric = fields.find((f) => f.key === "fabric")
    expect(fabric.status).toBe("known")
    expect(fabric.value).toBe("Softshell confirmado")
    expect(consumedKeys.has("fabric")).toBe(false)
  })

  it("reports consumed keys so the same datum is not also appended as a new question", () => {
    const { consumedKeys } = enrichLayersWithModel({
      garmentType: "Campera con capucha",
      layeredFields: layered.fields,
      modelFields: [{ key: "fabric", label: "Tela principal", category: "general", status: "ask", options: ["A", "B"] }],
    })
    expect(consumedKeys.has("fabric")).toBe(true)
  })

  it("gives an exact key match priority over a weaker containment match", () => {
    // "liningFabric" merely contains the alias "tela"; the real "fabric" field
    // must win the Materiales/fabric layer instead.
    const { fields } = enrichLayersWithModel({
      garmentType: "Campera con capucha",
      layeredFields: layered.fields,
      modelFields: [
        { key: "liningFabric", label: "Tela de forro", category: "general", status: "ask", options: ["Malla", "Taffeta"] },
        { key: "fabric", label: "Tela principal", category: "general", status: "ask", options: ["Softshell", "Ripstop"] },
      ],
    })
    expect(fields.find((f) => f.key === "fabric").options).toEqual(["Softshell", "Ripstop"])
  })

  it("leaves a layer untouched when the model field has fewer than 2 usable options", () => {
    const { fields } = enrichLayersWithModel({
      garmentType: "Campera con capucha",
      layeredFields: layered.fields,
      modelFields: [{ key: "fabric", label: "Tela", category: "general", status: "ask", options: ["Solo una"] }],
    })
    const fabric = fields.find((f) => f.key === "fabric")
    expect(fabric.tailored).toBeUndefined()
    expect(fabric.options.length).toBeGreaterThanOrEqual(2)
  })

  it("is a no-op with no model fields at all (pure offline intake still works)", () => {
    const { fields, consumedKeys } = enrichLayersWithModel({ garmentType: "Campera con capucha", layeredFields: layered.fields })
    expect(fields).toEqual(layered.fields)
    expect(consumedKeys.size).toBe(0)
  })
})
