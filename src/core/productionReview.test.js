import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({ deepseekChat: vi.fn() }))

import { deepseekChat } from "./deepseekClient.js"
import { fallbackProductionQuestions, authorProductionQuestions } from "./productionReview.js"

describe("fallbackProductionQuestions (deterministic floor)", () => {
  it("asks count, spacing, and gendered-side for a button design - the driving example", () => {
    const fields = fallbackProductionQuestions({
      parts: [],
      designs: [{ name: "Botonadura frontal", tec: "Botones metálicos", posDetail: "centro frente" }],
    })
    const labels = fields.map((f) => f.label)
    expect(labels.some((l) => /cuántos botones/i.test(l))).toBe(true)
    expect(labels.some((l) => /distancia.*botones/i.test(l))).toBe(true)
    expect(labels.some((l) => /cambia de lado.*femenina.*masculina/i.test(l))).toBe(true)
    expect(fields.every((f) => f.category === "production" && f.status === "ask" && f.options.length >= 2)).toBe(true)
  })

  it("asks thread color and backing for an embroidery design", () => {
    const fields = fallbackProductionQuestions({ designs: [{ name: "Logo pecho", tec: "Bordado 3D" }] })
    const labels = fields.map((f) => f.label)
    expect(labels.some((l) => /color de hilo/i.test(l))).toBe(true)
    expect(labels.some((l) => /backing/i.test(l))).toBe(true)
  })

  it("matches technique keywords from general parts too, not just designs", () => {
    const fields = fallbackProductionQuestions({ parts: [{ id: "closure", val: "Zipper YKK frontal", on: true }] })
    expect(fields.some((f) => /tirador/i.test(f.label))).toBe(true)
  })

  it("ignores a part that is switched off", () => {
    const fields = fallbackProductionQuestions({ parts: [{ id: "closure", val: "Zipper YKK", on: false }] })
    expect(fields).toHaveLength(0)
  })

  it("returns nothing when no technique keyword matches anything", () => {
    const fields = fallbackProductionQuestions({ parts: [{ id: "body", val: "French terry gris", on: true }], designs: [] })
    expect(fields).toHaveLength(0)
  })

  it("does not duplicate the same rule twice for the same subject", () => {
    const fields = fallbackProductionQuestions({ designs: [{ name: "X", tec: "Bordado y bordado otra vez" }] })
    const threadColorCount = fields.filter((f) => /color de hilo/i.test(f.label)).length
    expect(threadColorCount).toBe(1)
  })
})

describe("authorProductionQuestions (AI half, hybrid + deterministic fallback)", () => {
  beforeEach(() => {
    deepseekChat.mockReset()
  })

  it("returns [] when there is nothing to reason about (no parts, no designs)", async () => {
    const result = await authorProductionQuestions({ hdr: {}, parts: [], designs: [] })
    expect(result).toEqual([])
    expect(deepseekChat).not.toHaveBeenCalled()
  })

  it("normalizes a valid AI response into production-category walker fields", async () => {
    deepseekChat.mockResolvedValue(
      JSON.stringify({
        questions: [{ key: "button_count", label: "¿Cuántos botones?", options: ["2", "3", "4"], why: "define avíos" }],
      })
    )
    const result = await authorProductionQuestions({ hdr: {}, parts: [], designs: [{ name: "Botones", tec: "Botones" }] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: "production:ai:button_count", category: "production", status: "ask" })
    expect(deepseekChat).toHaveBeenCalledWith(expect.objectContaining({ task: "review" }))
  })

  it("falls back to the deterministic checklist when the AI content is unusable", async () => {
    // deepseekChat's own hybrid fallback machinery is mocked away here, so a
    // malformed/empty response simulates "hybrid ultimately fell through" -
    // the caller must still produce the deterministic checklist, not crash.
    deepseekChat.mockResolvedValue("not json")
    const result = await authorProductionQuestions({ hdr: {}, parts: [], designs: [{ name: "Botones", tec: "Botones" }] })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((f) => f.category === "production")).toBe(true)
  })

  it("caps at 8 questions and drops malformed entries", async () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({ key: "q" + i, label: "Pregunta " + i, options: ["A", "B"], why: "" }))
    questions.push({ key: "bad", label: "sin opciones" }) // malformed - dropped
    deepseekChat.mockResolvedValue(JSON.stringify({ questions }))
    const result = await authorProductionQuestions({ hdr: {}, parts: [], designs: [{ name: "X", tec: "Botones" }] })
    expect(result).toHaveLength(8)
    expect(result.every((f) => f.options.length >= 2)).toBe(true)
  })
})
