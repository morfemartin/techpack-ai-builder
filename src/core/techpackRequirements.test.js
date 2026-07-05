import { describe, it, expect, vi, beforeEach } from "vitest"
import { normalizeRequirements, pendingFields, applyAnswer, isComplete, reqsToParts, extractLastCompletedLabel } from "./techpackRequirements.js"

// Note: analyzeRequirements's real network behavior isn't tested here -
// deepseekClient.js already covers deepseekChat/deepseekChatStream directly.
// Only the pure walker helpers, the defensive normalizer, the label-extraction
// heuristic, and analyzeRequirements's onProgress wiring (mocked) are covered.

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  deepseekChatStream: vi.fn(),
  DeepSeekError: class DeepSeekError extends Error {},
}))

import { deepseekChat, deepseekChatStream } from "./deepseekClient.js"
import { analyzeRequirements, analyzeDesignExpression, mergeDesignFields, reqsToDesigns } from "./techpackRequirements.js"

describe("normalizeRequirements", () => {
  it("drops fields with no valid key and applies defaults", () => {
    const parsed = {
      garmentType: "camisa",
      fields: [
        { key: "", label: "ignored" },
        { key: 42 },
        { key: "color", status: "known", value: "rojo" },
        { key: "cuello", category: "design", options: ["", "Clasico", "Mao"] },
      ],
    }
    const result = normalizeRequirements(parsed, "camisa")
    expect(result.garmentType).toBe("camisa")
    expect(result.fields).toHaveLength(2)

    const color = result.fields.find((f) => f.key === "color")
    expect(color.label).toBe("color") // defaults to key
    expect(color.category).toBe("general")
    expect(color.status).toBe("known")
    expect(color.value).toBe("rojo")
    expect(color.options).toEqual([])
    expect(color.why).toBe("")

    const cuello = result.fields.find((f) => f.key === "cuello")
    expect(cuello.category).toBe("design")
    expect(cuello.options).toEqual(["Clasico", "Mao"]) // empty string filtered out
  })

  it("falls back garmentType to the arg when parsed.garmentType is missing", () => {
    expect(normalizeRequirements({ fields: [] }, "campera").garmentType).toBe("campera")
  })

  it("defaults an unrecognized status to ask and a non-string value to empty", () => {
    const result = normalizeRequirements({ fields: [{ key: "tela", status: "??", value: 123 }] }, "x")
    expect(result.fields[0].status).toBe("ask")
    expect(result.fields[0].value).toBe("")
  })
})

describe("pendingFields", () => {
  const reqs = {
    garmentType: "vestido",
    fields: [
      { key: "a", status: "ask", category: "general" },
      { key: "b", status: "known", category: "general" },
      { key: "c", status: "ask", category: "design" },
    ],
  }

  it("returns every ask-status field when no category is given", () => {
    expect(pendingFields(reqs).map((f) => f.key)).toEqual(["a", "c"])
  })

  it("filters to a single category when given", () => {
    expect(pendingFields(reqs, "design").map((f) => f.key)).toEqual(["c"])
    expect(pendingFields(reqs, "general").map((f) => f.key)).toEqual(["a"])
  })
})

describe("applyAnswer", () => {
  const reqs = {
    garmentType: "pantalon",
    fields: [{ key: "cintura", status: "ask", value: "", options: ["Elastico"], why: "", label: "Cintura", category: "general" }],
  }

  it("marks an existing field known with the value, without mutating the input", () => {
    const updated = applyAnswer(reqs, "cintura", "Elastico ajustable")
    expect(updated.fields[0].status).toBe("known")
    expect(updated.fields[0].value).toBe("Elastico ajustable")
    // original untouched
    expect(reqs.fields[0].status).toBe("ask")
    expect(reqs.fields[0].value).toBe("")
  })

  it("appends an unknown key as a new known general field", () => {
    const updated = applyAnswer(reqs, "largo", "Tobillero")
    expect(updated.fields).toHaveLength(2)
    const added = updated.fields.find((f) => f.key === "largo")
    expect(added).toEqual({ key: "largo", label: "largo", category: "general", status: "known", value: "Tobillero", options: [], why: "" })
  })
})

describe("isComplete", () => {
  it("is true when nothing still needs asking", () => {
    const reqs = { fields: [{ key: "x", status: "known", category: "general" }, { key: "y", status: "assumed", category: "design" }] }
    expect(isComplete(reqs)).toBe(true)
  })

  it("is false while an ask-status field remains", () => {
    const reqs = { fields: [{ key: "x", status: "ask", category: "general" }] }
    expect(isComplete(reqs)).toBe(false)
    expect(isComplete(reqs, "design")).toBe(true) // but complete within the design category
  })
})

describe("reqsToParts", () => {
  const reqs = {
    fields: [
      { key: "color", status: "known", value: "Rojo", category: "general", label: "Color" },
      { key: "manga", status: "assumed", value: "Manga larga", category: "general", label: "Manga" },
      { key: "cierre", status: "ask", value: "Botones", category: "general", label: "Cierre" },
      { key: "forro", status: "known", value: "   ", category: "general", label: "Forro" },
      { key: "logo", status: "known", value: "Bordado", category: "design", label: "Logo" },
    ],
  }

  it("includes known + assumed general fields that have a value", () => {
    expect(reqsToParts(reqs)).toEqual([
      { label: "Color", val: "Rojo" },
      { label: "Manga", val: "Manga larga" },
    ])
  })

  it("excludes ask-status, empty-value, and design-category fields", () => {
    const labels = reqsToParts(reqs).map((p) => p.label)
    expect(labels).not.toContain("Cierre") // still ask
    expect(labels).not.toContain("Forro") // whitespace value
    expect(labels).not.toContain("Logo") // design category
  })
})

describe("extractLastCompletedLabel", () => {
  it("returns the label of the last field whose object has fully closed (anchored on \"why\")", () => {
    const partial = '{"garmentType":"Camisa","fields":[{"key":"fabric","label":"Tela principal","category":"general","status":"ask","value":"","options":["A","B"],"why":"Define drapeado"},{"key":"collar","label":"Tipo de cuello","category":"general","status":"ask","value":"","options":["Italiano"'
    expect(extractLastCompletedLabel(partial)).toBe("Tela principal") // "collar" object hasn't reached "why" yet
  })

  it("returns null when no field has closed yet", () => {
    const partial = '{"garmentType":"Camisa","fields":[{"key":"fabric","label":"Tela principal","category":"general","status":"ask"'
    expect(extractLastCompletedLabel(partial)).toBeNull()
  })

  it("advances to the newly completed label once a later field also closes", () => {
    const partial = '{"fields":[{"label":"Tela principal","why":"x"},{"label":"Tipo de cuello","why":"y"}'
    expect(extractLastCompletedLabel(partial)).toBe("Tipo de cuello")
  })
})

describe("analyzeRequirements onProgress wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validResponse = '{"garmentType":"Camisa","fields":[{"key":"fabric","label":"Tela","category":"general","status":"ask","value":"","options":["A"],"why":"x"}]}'

  it("uses the plain (non-streaming) call when no onProgress callback is given", async () => {
    deepseekChat.mockResolvedValue(validResponse)
    await analyzeRequirements({ garmentType: "Camisa", seed: {}, tecs: [] })
    expect(deepseekChat).toHaveBeenCalledTimes(1)
    expect(deepseekChatStream).not.toHaveBeenCalled()
  })

  it("streams and reports increasing progress when onProgress is given, still returning a valid result", async () => {
    deepseekChatStream.mockImplementation(async ({ onEvent }) => {
      onEvent({ contentSoFar: '{"fields":[{"label":"Tela","why":"x"}', tokensSoFar: 10 })
      onEvent({ contentSoFar: validResponse, tokensSoFar: 30 })
      return validResponse
    })
    const seen = []
    const result = await analyzeRequirements({ garmentType: "Camisa", seed: {}, tecs: [], onProgress: (p) => seen.push(p) })

    expect(deepseekChatStream).toHaveBeenCalledTimes(1)
    expect(deepseekChat).not.toHaveBeenCalled()
    expect(seen.length).toBe(2)
    expect(seen[1].percent).toBeGreaterThan(seen[0].percent)
    expect(seen[0].lastLabel).toBe("Tela")
    expect(result.garmentType).toBe("Camisa")
    expect(result.fields[0].label).toBe("Tela")
  })
})

describe("mergeDesignFields", () => {
  it("appends designFields to reqs.fields without mutating original reqs", () => {
    const reqs = { garmentType: "Camisa", fields: [{ key: "tela", label: "Tela", category: "general", status: "known", value: "Algodon", options: [], why: "" }] }
    const designFields = [{ key: "logo_pecho_nombre", label: "Nombre", category: "design", status: "ask", value: "", options: ["Logo A", "Logo B"], why: "", designSlot: "logo_pecho", designField: "name" }]
    const merged = mergeDesignFields(reqs, designFields)
    expect(merged.fields).toHaveLength(2)
    expect(merged.fields[1]).toEqual(designFields[0])
    expect(reqs.fields).toHaveLength(1)
  })

  it("handles null/undefined reqs by treating as empty fields array", () => {
    const designFields = [{ key: "logo_pecho_nombre", label: "Nombre", category: "design", status: "ask", value: "", options: [], why: "", designSlot: "logo_pecho", designField: "name" }]
    const merged = mergeDesignFields(null, designFields)
    expect(merged.fields).toEqual(designFields)
    expect(merged.garmentType).toBeUndefined()
  })
})

describe("reqsToDesigns", () => {
  it("groups fields by designSlot into correct shape", () => {
    const reqs = {
      fields: [
        { key: "logo_pecho_nombre", label: "Nombre", category: "design", status: "known", value: "Logo Pecho", options: [], why: "", designSlot: "logo_pecho", designField: "name" },
        { key: "logo_pecho_posicion", label: "Posicion", category: "design", status: "known", value: "Pecho izquierdo", options: [], why: "", designSlot: "logo_pecho", designField: "position" },
        { key: "logo_pecho_tecnica", label: "Tecnica", category: "design", status: "known", value: "Bordado 3D", options: [], why: "", designSlot: "logo_pecho", designField: "technique" },
        { key: "logo_pecho_drive", label: "Drive", category: "design", status: "known", value: "https://drive.com/logo", options: [], why: "", designSlot: "logo_pecho", designField: "driveLink" },
        { key: "logo_pecho_detalle", label: "Tamano", category: "design", status: "known", value: "5cm", options: [], why: "", designSlot: "logo_pecho", designField: "detail" },
      ],
    }
    const designs = reqsToDesigns(reqs)
    expect(designs).toHaveLength(1)
    expect(designs[0]).toEqual({
      name: "Logo Pecho",
      pos: "Pecho izquierdo",
      tec: "Bordado 3D",
      driveLink: "https://drive.com/logo",
      posDetail: "5cm",
      notes: "Tamano: 5cm",
    })
  })

  it("falls back to humanized designSlot name when no name field exists", () => {
    const reqs = {
      fields: [
        { key: "botones_cantidad", label: "Cantidad", category: "design", status: "known", value: "4", options: [], why: "", designSlot: "botones_personalizados", designField: "detail" },
      ],
    }
    const designs = reqsToDesigns(reqs)
    expect(designs[0].name).toBe("Botones Personalizados")
  })

  it("excludes ask status fields and empty-value fields", () => {
    const reqs = {
      fields: [
        { key: "logo_pecho_nombre", label: "Nombre", category: "design", status: "ask", value: "", options: [], why: "", designSlot: "logo_pecho", designField: "name" },
        { key: "logo_pecho_posicion", label: "Posicion", category: "design", status: "known", value: "", options: [], why: "", designSlot: "logo_pecho", designField: "position" },
      ],
    }
    const designs = reqsToDesigns(reqs)
    expect(designs).toHaveLength(0)
  })

  it("joins multiple detail fields into notes correctly", () => {
    const reqs = {
      fields: [
        { key: "botones_cantidad", label: "Cantidad", category: "design", status: "known", value: "4", options: [], why: "", designSlot: "botones", designField: "detail" },
        { key: "botones_material", label: "Material", category: "design", status: "known", value: "Nacar", options: [], why: "", designSlot: "botones", designField: "detail" },
        { key: "botones_nombre", label: "Nombre", category: "design", status: "known", value: "Botones", options: [], why: "", designSlot: "botones", designField: "name" },
      ],
    }
    const designs = reqsToDesigns(reqs)
    expect(designs[0].notes).toBe("Cantidad: 4, Material: Nacar")
    expect(designs[0].posDetail).toBe("4")
  })

  it("ignores fields with missing/unrecognized designSlot or designField without throwing", () => {
    const reqs = {
      fields: [
        { key: "sin_slot", label: "Sin Slot", category: "design", status: "known", value: "x", options: [], why: "", designSlot: "", designField: "name" },
        { key: "campo_raro", label: "Raro", category: "design", status: "known", value: "y", options: [], why: "", designSlot: "raro", designField: "color" },
        { key: "logo_pecho_nombre", label: "Nombre", category: "design", status: "known", value: "Logo", options: [], why: "", designSlot: "logo_pecho", designField: "name" },
      ],
    }
    const designs = reqsToDesigns(reqs)
    expect(designs).toHaveLength(1)
    expect(designs[0].name).toBe("Logo")
  })
})

describe("analyzeDesignExpression", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls deepseekChat when no onProgress is given", async () => {
    deepseekChat.mockResolvedValue(JSON.stringify({ garmentType: "Camisa", fields: [] }))
    const result = await analyzeDesignExpression({ garmentType: "Camisa", generalFields: [], tecs: ["Bordado 3D"] })
    expect(deepseekChat).toHaveBeenCalledOnce()
    expect(deepseekChatStream).not.toHaveBeenCalled()
    expect(result).toHaveProperty("garmentType", "Camisa")
    expect(result).toHaveProperty("fields")
  })

  it("calls deepseekChatStream when onProgress is given", async () => {
    deepseekChatStream.mockResolvedValue(JSON.stringify({ garmentType: "Camisa", fields: [] }))
    const onProgress = vi.fn()
    const result = await analyzeDesignExpression({ garmentType: "Camisa", generalFields: [], tecs: ["Bordado 3D"], onProgress })
    expect(deepseekChatStream).toHaveBeenCalledOnce()
    expect(deepseekChat).not.toHaveBeenCalled()
    expect(result).toHaveProperty("garmentType", "Camisa")
  })

  it("throws DeepSeekError on invalid JSON response", async () => {
    deepseekChat.mockResolvedValue("esto no es json")
    await expect(analyzeDesignExpression({ garmentType: "Camisa", generalFields: [], tecs: [] })).rejects.toThrow("El asistente de IA no devolvio un analisis de disenos valido.")
  })

  it("returns normalized result with fields array from parsed response", async () => {
    const mockFields = [
      { key: "logo_pecho_nombre", label: "Nombre", category: "design", status: "ask", value: "", options: ["Logo A"], why: "importante", designSlot: "logo_pecho", designField: "name" },
    ]
    deepseekChat.mockResolvedValue(JSON.stringify({ garmentType: "Camisa", fields: mockFields }))
    const result = await analyzeDesignExpression({ garmentType: "Camisa", generalFields: [{ label: "Tela", val: "Algodon" }], tecs: ["Bordado 3D"] })
    expect(result.fields).toHaveLength(1)
    expect(result.fields[0].key).toBe("logo_pecho_nombre")
    expect(result.fields[0].category).toBe("design")
  })
})
