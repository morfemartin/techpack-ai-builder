import { describe, it, expect } from "vitest"
import { normalizeRequirements, pendingFields, applyAnswer, isComplete, reqsToParts } from "./techpackRequirements.js"

// Note: analyzeRequirements is NOT tested here - it hits the network. Only the
// pure walker helpers + the defensive normalizer are covered.

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
