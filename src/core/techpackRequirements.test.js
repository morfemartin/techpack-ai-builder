import { describe, it, expect, vi, beforeEach } from "vitest"
import { normalizeRequirements, ensureMinimumGeneralQuestions, fallbackRequirements, fallbackDesignFields, pendingFields, applyAnswer, skipField, revertField, looksLikeQuestion, isComplete, reqsToParts, extractLastCompletedLabel } from "./techpackRequirements.js"

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
import { analyzeRequirements, analyzeDesignExpression, mergeDesignFields, reqsToDesigns, authorIllustrationBriefs, attachIllustrationBriefs, answerFieldQuestion, analyzeAdditionalNotes } from "./techpackRequirements.js"

describe("normalizeRequirements dedup", () => {
  it("collapses two general fields that ask the same thing under different wording", () => {
    // A weak model asks "Cuello" and "Tipo de cuello" - the same question. No
    // template floor absorbs the overlap now, so the normalizer must.
    const result = normalizeRequirements({
      garmentType: "franela",
      fields: [
        { key: "cuello", label: "Cuello", category: "general", status: "ask", options: ["A", "B"] },
        { key: "tipo_cuello", label: "Tipo de cuello", category: "general", status: "ask", options: ["C", "D"] },
        { key: "manga", label: "Manga", category: "general", status: "ask", options: ["E", "F"] },
        { key: "construccion_manga", label: "Construccion de manga", category: "general", status: "ask", options: ["G", "H"] },
      ],
    }, "franela")
    expect(result.fields.map((f) => f.label)).toEqual(["Cuello", "Manga"])
  })

  it("drops an exact duplicate key, keeping the first", () => {
    const result = normalizeRequirements({
      garmentType: "x",
      fields: [
        { key: "tela", label: "Tela", category: "general", status: "ask", options: ["A", "B"], value: "first" },
        { key: "tela", label: "Material", category: "general", status: "known", value: "second" },
      ],
    }, "x")
    expect(result.fields).toHaveLength(1)
    expect(result.fields[0].value).toBe("first")
  })

  it("never dedups design-category fields - they repeat a slot on purpose", () => {
    const result = normalizeRequirements({
      garmentType: "x",
      fields: [
        { key: "logo_name", label: "Nombre", category: "design", designSlot: "logo", designField: "name", status: "ask", options: ["A", "B"] },
        { key: "logo_pos", label: "Nombre", category: "design", designSlot: "logo", designField: "position", status: "ask", options: ["A", "B"] },
      ],
    }, "x")
    expect(result.fields).toHaveLength(2)
  })
})

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

  it("preserves optional only when it is the boolean true", () => {
    const result = normalizeRequirements({ fields: [{ key: "margen", optional: true }, { key: "archivo", optional: "true" }] }, "x")
    expect(result.fields[0].optional).toBe(true)
    expect(result.fields[1].optional).toBeUndefined()
  })
})

describe("ensureMinimumGeneralQuestions", () => {
  it("builds the complete layered contract when a new typed garment has no usable questions", () => {
    const reqs = {
      garmentType: "polo",
      fields: [
        { key: "collar_assumed", label: "Cuello", category: "general", status: "assumed", value: "Cuello polo", options: [], why: "" },
      ],
    }

    const result = ensureMinimumGeneralQuestions(reqs, {})
    const asks = pendingFields(result, "general")

    expect(asks.length).toBeGreaterThanOrEqual(10)
    expect(asks[0].label).toBe("Uso principal")
    expect(asks.every((field) => field.layer && field.example && field.options.length > 1)).toBe(true)
  })

  it("does not let a partial model answer remove factory-critical layers", () => {
    const reqs = {
      garmentType: "polo",
      fields: [{ key: "fabric", label: "Tela", category: "general", status: "ask", value: "", options: ["A", "B"], why: "" }],
    }
    const result = ensureMinimumGeneralQuestions(reqs, {})
    expect(pendingFields(result, "general").map((field) => field.key)).toEqual(expect.arrayContaining(["fabric", "fit", "size_range", "production_notes", "collar", "placket"]))
  })

  it("keeps asking production decisions even when an initial seed has facts", () => {
    const reqs = { garmentType: "polo", fields: [] }
    expect(pendingFields(ensureMinimumGeneralQuestions(reqs, { Color: "Azul" }), "general").map((field) => field.label)).toContain("Tela principal")
  })

  it("builds hoodie-specific local fallback questions when IA is unavailable", () => {
    const result = fallbackRequirements("hoodie", {})
    const labels = pendingFields(result, "general").map((f) => f.label)

    expect(labels).toContain("Tela principal")
    expect(labels).toContain("Capucha")
    expect(labels).toContain("Bolsillos")
    expect(labels).toContain("Terminaciones visibles")
  })

  // Regression guard for the "chat lost its depth" report: a model field that
  // does NOT match any fixed layer must now SURVIVE (additive), instead of
  // being silently discarded the way it was before this fix.
  it("keeps the model's genuinely new garment-specific question on top of the layer floor", () => {
    const reqs = {
      garmentType: "hoodie",
      fields: [
        { key: "drawcord_tips", label: "Herrajes del cordón", category: "general", status: "ask", value: "", options: ["Metal", "Plástico"], why: "define acabado del cordón" },
      ],
    }
    const result = ensureMinimumGeneralQuestions(reqs, {})
    const asks = pendingFields(result, "general")
    // the layer floor is still fully present...
    expect(asks.map((f) => f.key)).toEqual(expect.arrayContaining(["fabric", "fit", "hood"]))
    // ...AND the model's specific question was not thrown away
    expect(asks.map((f) => f.key)).toContain("drawcord_tips")
  })

  // The "todo se siente generico" report: coverage was guaranteed, but the
  // model's garment-specific version of a layer was discarded in favour of the
  // fixed template options, so a technical jacket got asked the same cotton-polo
  // options as everything else. It must now TAILOR the layer in place.
  it("lets the model tailor a layer's options to this garment instead of keeping the generic ones", () => {
    const reqs = {
      garmentType: "Campera con capucha",
      fields: [
        { key: "fabric", label: "Tela principal (shell)", category: "general", status: "ask", value: "", options: ["Softshell 3 capas", "Nylon ripstop", "Membrana impermeable"], why: "define impermeabilidad" },
      ],
    }
    const result = ensureMinimumGeneralQuestions(reqs, {})
    const fabric = pendingFields(result, "general").find((f) => f.key === "fabric")
    expect(fabric.options).toEqual(["Softshell 3 capas", "Nylon ripstop", "Membrana impermeable"])
    expect(fabric.tailored).toBe(true)
    // and it is asked exactly once - not once tailored plus once appended
    expect(pendingFields(result, "general").filter((f) => /tela principal/i.test(f.label))).toHaveLength(1)
  })

  it("still drops a model field that duplicates a layer (by key) rather than asking it twice", () => {
    const reqs = {
      garmentType: "hoodie",
      fields: [{ key: "fabric_v2", label: "Tela principal", category: "general", status: "ask", value: "", options: ["A", "B"], why: "" }],
    }
    const result = ensureMinimumGeneralQuestions(reqs, {})
    const asks = pendingFields(result, "general")
    expect(asks.filter((f) => f.label === "Tela principal")).toHaveLength(1)
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

describe("fallbackDesignFields", () => {
  it("collects a usable design brief when a selected application cannot be analyzed by AI", () => {
    const fields = fallbackDesignFields({ fields: [{ key: "applications", value: "Logo / bordado" }] })
    expect(fields.map((field) => field.designField)).toEqual(["name", "position", "technique"])
    expect(fields.every((field) => field.category === "design" && field.options.length >= 2 && field.example)).toBe(true)
  })

  it("does not create a design page when the user confirmed there is no application", () => {
    expect(fallbackDesignFields({ fields: [{ key: "applications", value: "Sin aplicacion" }] })).toEqual([])
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

describe("skipField", () => {
  const reqs = {
    garmentType: "campera",
    fields: [
      { key: "archivo_cierre", status: "ask", value: "", options: [], why: "", label: "Archivo cierre", category: "design", optional: true },
      { key: "otro", status: "ask", value: "", options: [], why: "", label: "Otro", category: "design" },
    ],
  }

  it("removes a field from the ask queue without assigning a value", () => {
    const skipped = skipField(reqs, "archivo_cierre")
    expect(skipped.fields[0].status).toBe("assumed")
    expect(skipped.fields[0].value).toBe("")
    expect(pendingFields(skipped, "design").map((f) => f.key)).toEqual(["otro"])
  })

  it("does not mutate the input", () => {
    skipField(reqs, "archivo_cierre")
    expect(reqs.fields[0].status).toBe("ask")
  })
})

describe("revertField", () => {
  const reqs = {
    garmentType: "pantalon",
    fields: [{ key: "cintura", status: "known", value: "Elastico ajustable", options: ["Elastico"], why: "", label: "Cintura", category: "general" }],
  }

  it("puts an answered field back to ask with an empty value", () => {
    const reverted = revertField(reqs, "cintura")
    expect(reverted.fields[0].status).toBe("ask")
    expect(reverted.fields[0].value).toBe("")
    expect(pendingFields(reverted, "general").map((f) => f.key)).toEqual(["cintura"])
  })

  it("does not mutate the input", () => {
    revertField(reqs, "cintura")
    expect(reqs.fields[0].status).toBe("known")
    expect(reqs.fields[0].value).toBe("Elastico ajustable")
  })

  it("leaves other fields untouched", () => {
    const two = { fields: [{ key: "a", status: "known", value: "x" }, { key: "b", status: "assumed", value: "y" }] }
    const reverted = revertField(two, "a")
    expect(reverted.fields[1]).toEqual(two.fields[1])
  })
})

describe("looksLikeQuestion", () => {
  it("is true for text containing a question mark (Spanish or plain)", () => {
    expect(looksLikeQuestion("¿que es eso?")).toBe(true)
    expect(looksLikeQuestion("que es eso?")).toBe(true)
    expect(looksLikeQuestion("what is that?")).toBe(true)
  })

  it("is false for a plain answer with no question mark", () => {
    expect(looksLikeQuestion("Bordado 3D")).toBe(false)
    expect(looksLikeQuestion("")).toBe(false)
  })

  it("handles null/undefined without throwing", () => {
    expect(looksLikeQuestion(null)).toBe(false)
    expect(looksLikeQuestion(undefined)).toBe(false)
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

  it("returns the model's own questionnaire, with no template layers padded in", async () => {
    // The fixed layer floor used to be merged on top of every analysis. It
    // assumes a torso garment, so a pair of socks got asked about its collar,
    // sleeve and chest pocket. Coherence is the model's job now: what it
    // reasoned is exactly what the user is asked, nothing bolted on.
    const socks = '{"garmentType":"Medias","fields":[' + [
      '{"key":"cuff","label":"Puno","category":"general","status":"ask","value":"","options":["Rib alto","Rib bajo"],"why":"x"}',
      '{"key":"heel","label":"Talon","category":"general","status":"ask","value":"","options":["Reforzado","Simple"],"why":"x"}',
      '{"key":"arch","label":"Soporte de arco","category":"general","status":"ask","value":"","options":["Con soporte","Sin soporte"],"why":"x"}',
      '{"key":"toe","label":"Puntera","category":"general","status":"ask","value":"","options":["Costura plana","Costura simple"],"why":"x"}',
      '{"key":"yarn","label":"Hilado","category":"general","status":"ask","value":"","options":["Algodon","Coolmax"],"why":"x"}',
      '{"key":"height","label":"Altura","category":"general","status":"ask","value":"","options":["Tobillera","Media caña"],"why":"x"}',
    ].join(",") + ']}'
    deepseekChat.mockResolvedValue(socks)
    const result = await analyzeRequirements({ garmentType: "Medias", seed: {}, tecs: [] })
    const labels = result.fields.map((f) => f.label)
    expect(labels).toEqual(["Puno", "Talon", "Soporte de arco", "Puntera", "Hilado", "Altura"])
    expect(labels.some((l) => /cuello|manga|bolsillo/i.test(l))).toBe(false)
  })

  it("rejects a thin analysis instead of quietly padding it out", async () => {
    // Under 6 real questions there is not enough to build a tech pack from.
    // The validator must refuse it so the other provider gets a turn and a
    // total failure surfaces - rather than the old behaviour of topping it up
    // with template questions and looking like it worked.
    deepseekChat.mockImplementation(async ({ validator }) => {
      const thin = '{"garmentType":"polo","fields":[{"key":"tipo","label":"Tipo","category":"general","status":"ask","value":"","options":["A","B"],"why":"x"}]}'
      expect(validator(thin)).toBe(false)
      return thin
    })
    await analyzeRequirements({ garmentType: "polo", seed: {}, tecs: [] })
  })

  it("requires every question it shows to carry 2-4 numbered options", async () => {
    deepseekChat.mockImplementation(async ({ validator }) => {
      const noOptions = '{"garmentType":"polo","fields":[' + Array.from({ length: 8 }, (_, i) =>
        `{"key":"f${i}","label":"F${i}","category":"general","status":"ask","value":"","options":[],"why":"x"}`).join(",") + ']}'
      expect(validator(noOptions)).toBe(false)
      return noOptions
    })
    await analyzeRequirements({ garmentType: "polo", seed: {}, tecs: [] })
  })

  it("streams completed technical fields when onProgress is given, still returning a valid result", async () => {
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
    expect(seen[1].tokensSoFar).toBeGreaterThan(seen[0].tokensSoFar)
    expect(seen[0].lastLabel).toBe("Tela")
    expect(seen[1].completedLabels).toEqual(["Tela"])
    expect(result.garmentType).toBe("Camisa")
    expect(result.fields.map((f) => f.label)).toEqual(["Tela"])
  })

  it("salvages a usable field list when the stream hit the token cap mid-JSON", async () => {
    // deepseekChatStream now resolves with whatever content it accumulated
    // even on a finish_reason:"length" cutoff (see deepseekClient.js) - this
    // simulates that: 8 complete fields, cut mid-way through the 9th.
    const fields = Array.from({ length: 8 }, (_, i) => `{"key":"f${i}","label":"F${i}","category":"general","status":"ask","options":["A"],"why":"x"}`).join(",")
    deepseekChatStream.mockResolvedValue(`{"garmentType":"Camisa","fields":[${fields},{"key":"f8`)

    const result = await analyzeRequirements({ garmentType: "Camisa", seed: {}, tecs: [], onProgress: () => {} })
    expect(result.garmentType).toBe("Camisa")
    // the 8 complete fields survive the cutoff; the truncated 9th is dropped
    expect(result.fields.map((f) => f.key)).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"])
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

describe("authorIllustrationBriefs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("resolves with { briefs: [] } and makes no API call when designs is empty", async () => {
    const result = await authorIllustrationBriefs({ garmentType: "Camisa", designs: [] })
    expect(result).toEqual({ briefs: [] })
    expect(deepseekChat).not.toHaveBeenCalled()
    expect(deepseekChatStream).not.toHaveBeenCalled()
  })

  it("calls deepseekChat when no onProgress, returns parsed briefs", async () => {
    deepseekChat.mockResolvedValueOnce('{"briefs":[{"name":"Logo","illustrationBrief":"Dibujar logo bordado en pecho izquierdo"}]}')
    const designs = [{ name: "Logo", pos: "Pecho", tec: "Bordado" }]
    const result = await authorIllustrationBriefs({ garmentType: "Camisa", designs })
    expect(deepseekChat).toHaveBeenCalledTimes(1)
    expect(deepseekChatStream).not.toHaveBeenCalled()
    expect(result.briefs).toHaveLength(1)
    expect(result.briefs[0].name).toBe("Logo")
  })

  it("calls deepseekChatStream when onProgress is provided", async () => {
    deepseekChatStream.mockResolvedValueOnce('{"briefs":[]}')
    const onProgress = vi.fn()
    await authorIllustrationBriefs({ garmentType: "Camisa", designs: [{ name: "Boton" }], onProgress })
    expect(deepseekChatStream).toHaveBeenCalledTimes(1)
    expect(deepseekChat).not.toHaveBeenCalled()
  })

  it("filters out entries with missing/empty name", async () => {
    deepseekChat.mockResolvedValueOnce('{"briefs":[{"name":"","illustrationBrief":"x"},{"name":"Boton","illustrationBrief":"y"}]}')
    const result = await authorIllustrationBriefs({ garmentType: "Camisa", designs: [{ name: "Boton" }] })
    expect(result.briefs).toHaveLength(1)
    expect(result.briefs[0].name).toBe("Boton")
  })

  it("throws DeepSeekError on invalid JSON", async () => {
    deepseekChat.mockResolvedValueOnce("not json")
    await expect(authorIllustrationBriefs({ garmentType: "Camisa", designs: [{ name: "X" }] }))
      .rejects.toThrow("El asistente de IA no devolvio")
  })
})

describe("attachIllustrationBriefs", () => {
  it("attaches matching brief by name, returns new array without mutating input", () => {
    const designs = [{ name: "Logo", pos: "Pecho" }, { name: "Boton", pos: "Manga" }]
    const briefs = [{ name: "Logo", illustrationBrief: "Dibujar logo" }]
    const result = attachIllustrationBriefs(designs, briefs)
    expect(result).not.toBe(designs)
    expect(result[0].illustrationBrief).toBe("Dibujar logo")
    expect(result[1].illustrationBrief).toBe("")
    expect(designs[0].illustrationBrief).toBeUndefined()
  })

  it("defaults illustrationBrief to '' for unmatched designs", () => {
    const result = attachIllustrationBriefs([{ name: "X" }], [])
    expect(result[0].illustrationBrief).toBe("")
  })

  it("handles null/undefined inputs without throwing", () => {
    expect(() => attachIllustrationBriefs(null, undefined)).not.toThrow()
    expect(attachIllustrationBriefs(null, undefined)).toEqual([])
  })
})

describe("answerFieldQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("always uses the non-streaming call and returns plain trimmed text", async () => {
    deepseekChat.mockResolvedValueOnce("```\nEs una tecnica de bordado con relieve.\n```")
    const field = { label: "Tecnica", why: "define el acabado", options: ["Bordado 3D", "Bordado Plano"] }
    const answer = await answerFieldQuestion({ field, garmentType: "Hoodie", question: "que es bordado 3d?" })
    expect(deepseekChat).toHaveBeenCalledTimes(1)
    expect(deepseekChatStream).not.toHaveBeenCalled()
    expect(answer).toBe("Es una tecnica de bordado con relieve.")
  })

  it("includes the field's options in the prompt when present", async () => {
    deepseekChat.mockResolvedValueOnce("respuesta")
    await answerFieldQuestion({ field: { label: "Tecnica", options: ["A", "B"] }, garmentType: "Hoodie", question: "cual es mejor?" })
    const prompt = deepseekChat.mock.calls[0][0].messages[0].content
    expect(prompt).toContain("A, B")
  })
})

describe("analyzeAdditionalNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls the non-streaming call and returns normalized fields", async () => {
    deepseekChat.mockResolvedValueOnce('{"fields":[{"key":"reflectivo","label":"Cinta reflectiva","category":"general","status":"known","value":"1cm en el bolsillo"}]}')
    const fields = await analyzeAdditionalNotes({ garmentType: "Hoodie", existingFields: [], notes: "me olvide, quiero una cinta reflectiva de 1cm en el bolsillo" })
    expect(deepseekChat).toHaveBeenCalledTimes(1)
    expect(fields).toHaveLength(1)
    expect(fields[0].key).toBe("reflectivo")
    expect(fields[0].status).toBe("known")
  })

  it("returns an empty array when the model finds nothing new", async () => {
    deepseekChat.mockResolvedValueOnce('{"fields":[]}')
    const fields = await analyzeAdditionalNotes({ garmentType: "Hoodie", existingFields: [], notes: "nada mas" })
    expect(fields).toEqual([])
  })

  it("throws DeepSeekError on invalid JSON", async () => {
    deepseekChat.mockResolvedValueOnce("esto no es json")
    await expect(analyzeAdditionalNotes({ garmentType: "Hoodie", existingFields: [], notes: "x" })).rejects.toThrow("El asistente de IA no pudo interpretar esas notas.")
  })
})
