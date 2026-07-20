import { describe, expect, it } from "vitest"
import { applyReviewAnswers, parseAnswerKey } from "./applyReviewAnswers.js"
import { EMPTY_EMB } from "./helpers.js"
import { flattenRegions } from "../pages/pageContracts.js"

function regions(...types) {
  return types.map((type) => ({ type, weight: 10 }))
}

function baseInput() {
  return {
    hdr: { brand: "Morfe", pname: "Hoodie", sno: "" },
    parts: [
      { id: "body", val: "French terry", on: true },
      { id: "hood", val: "Double layer", on: true },
    ],
    designs: [
      { name: "Chest", colors: [{ name: "Blue", hex: "#003DA5" }], emb: { machine: "Tajima" } },
      { name: "Back", colors: [], emb: { ...EMPTY_EMB, stopSeq: [] } },
    ],
    plan: {
      pages: [
        { id: "cover", title: "Hoodie", purpose: "cover", regions: regions("header", "titleBar", "illustration", "disclaimer") },
        { id: "overview", title: "Overview", purpose: "overview", regions: regions("header", "titleBar", "illustration", "partsList", "disclaimer") },
        { id: "design-chest", title: "Chest", purpose: "design:Chest", regions: regions("header", "titleBar", "illustration", "colorSpecs", "embSpecs", "disclaimer") },
        { id: "design-back", title: "Back", purpose: "design:Back", regions: regions("header", "titleBar", "illustration", "disclaimer") },
      ],
    },
  }
}

function typesOf(page) {
  return flattenRegions(page.regions).map((region) => region.type)
}

describe("applyReviewAnswers", () => {
  it("parses review keys without losing colons in the field", () => {
    expect(parseAnswerKey("review:design:Chest: Left")).toEqual({ topic: "design", field: "Chest: Left" })
    expect(parseAnswerKey("other:key")).toBe(null)
  })

  it("updates a missing header value without mutating the input", () => {
    const input = baseInput()
    const before = JSON.stringify(input)
    const result = applyReviewAnswers(input, [{ key: "review:header:sno", choice: 0, value: "HD-027" }])
    expect(result.hdr.sno).toBe("HD-027")
    expect(JSON.stringify(input)).toBe(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ action: "updated", topic: "header", field: "sno" }))
  })

  it("leaves an intentionally blank header untouched", () => {
    const result = applyReviewAnswers(baseInput(), [{ key: "review:header:sno", choice: 1 }])
    expect(result.hdr.sno).toBe("")
    expect(result.changes).toEqual([])
  })

  it("deletes a part from the project and marks the BOM page affected", () => {
    const result = applyReviewAnswers(baseInput(), [{ key: "review:part:hood", choice: 1 }])
    expect(result.parts.map((part) => part.id)).toEqual(["body"])
    expect(result.affectedPageIds).toContain("overview")
  })

  it("deletes multiple designs and their pages in one review round", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "review:design:Chest", choice: 1 },
      { key: "review:design:Back", choice: 1 },
    ])
    expect(result.designs).toEqual([])
    expect(result.plan.pages.some((page) => String(page.purpose).startsWith("design:"))).toBe(false)
    expect(result.removedPageIds).toEqual(expect.arrayContaining(["design-chest", "design-back"]))
  })

  it("adds a missing design page and repairs it to the design contract", () => {
    const input = baseInput()
    input.plan.pages = input.plan.pages.filter((page) => page.purpose !== "design:Back")
    const result = applyReviewAnswers(input, [{ key: "review:design:Back", choice: 0 }])
    const page = result.plan.pages.find((item) => item.purpose === "design:Back")
    expect(page).toBeTruthy()
    expect(typesOf(page)).toEqual(expect.arrayContaining(["header", "titleBar", "illustration", "disclaimer"]))
    expect(result.affectedPageIds).toContain(page.id)
  })

  it("adds missing color and embroidery blocks for existing design data", () => {
    const input = baseInput()
    input.plan.pages.find((page) => page.purpose === "design:Chest").regions = regions("header", "titleBar", "illustration", "disclaimer")
    const result = applyReviewAnswers(input, [
      { key: "review:design-colors:Chest", choice: 0 },
      { key: "review:design-emb:Chest", choice: 0 },
    ])
    const page = result.plan.pages.find((item) => item.purpose === "design:Chest")
    expect(typesOf(page)).toEqual(expect.arrayContaining(["colorSpecs", "embSpecs"]))
    expect(result.affectedPageIds).toContain("design-chest")
  })

  it("deletes colors and embroidery data and removes their regions", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "review:design-colors:Chest", choice: 1 },
      { key: "review:design-emb:Chest", choice: 1 },
    ])
    const design = result.designs.find((item) => item.name === "Chest")
    const page = result.plan.pages.find((item) => item.purpose === "design:Chest")
    expect(design.colors).toEqual([])
    expect(design.emb).toEqual(EMPTY_EMB)
    expect(typesOf(page)).not.toContain("colorSpecs")
    expect(typesOf(page)).not.toContain("embSpecs")
  })

  it("is a no-op clone for the skip/export path", () => {
    const input = baseInput()
    const result = applyReviewAnswers(input, [])
    expect(result.hdr).toEqual(input.hdr)
    expect(result.parts).toEqual(input.parts)
    expect(result.designs).toEqual(input.designs)
    expect(result.changes).toEqual([])
    expect(result.hdr).not.toBe(input.hdr)
  })
})

// The 4th round (src/core/productionReview.js): answers a QUESTION, so it
// writes a readable note instead of toggling a region's presence.
describe("applyReviewAnswers - production round (4th review)", () => {
  it("appends a design-tied answer to that design's notes and marks its page affected", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "production:buttons:design:Chest:count", choice: 0, option: "3-4", label: "¿Cuántos botones lleva el diseño \"Chest\"?" },
    ])
    const design = result.designs.find((d) => d.name === "Chest")
    expect(design.notes).toBe('¿Cuántos botones lleva el diseño "Chest"?: 3-4')
    expect(result.affectedPageIds).toContain("design-chest")
  })

  it("accumulates multiple production answers onto the same design as separate lines", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "production:buttons:design:Chest:count", choice: 0, option: "3-4", label: "¿Cuántos botones?" },
      { key: "production:buttons:design:Chest:spacing", choice: 0, option: "Equidistante", label: "¿Qué distancia entre botones?" },
    ])
    const design = result.designs.find((d) => d.name === "Chest")
    expect(design.notes.split("\n")).toHaveLength(2)
  })

  it("appends a part-tied answer directly onto that part's printed value", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "production:closure-zipper:part:body:pull", choice: 0, option: "Tirador de tela a juego", label: "¿Qué tipo de tirador lleva el cierre?" },
    ])
    const part = result.parts.find((p) => p.id === "body")
    expect(part.val).toBe("French terry — Tirador de tela a juego")
  })

  it("falls back to the first design for an untied AI question with no named subject", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "production:ai:hardware_finish", choice: 0, option: "Níquel mate", label: "¿Acabado de los herrajes?" },
    ])
    expect(result.designs[0].notes).toContain("Níquel mate")
  })

  it("prefers a typed free-text value over the option label when both are present", () => {
    const result = applyReviewAnswers(baseInput(), [
      { key: "production:ai:custom_note", choice: 0, option: "Completar ahora (escribí el valor)", value: "12mm exactos", label: "¿Ancho del dobladillo?" },
    ])
    expect(result.designs[0].notes).toContain("12mm exactos")
    expect(result.designs[0].notes).not.toContain("Completar ahora")
  })

  it("ignores a production answer with no matching label (defensive, never crashes)", () => {
    expect(() => applyReviewAnswers(baseInput(), [{ key: "production:ai:x", choice: 0, option: "Y" }])).not.toThrow()
  })
})
