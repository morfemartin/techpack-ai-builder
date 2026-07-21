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

  it("asks color count and wash durability for a print/DTF/sublimation design", () => {
    const fields = fallbackProductionQuestions({ designs: [{ name: "Grafica espalda", tec: "DTF" }] })
    const labels = fields.map((f) => f.label)
    expect(labels.some((l) => /cuántos colores.*tintas/i.test(l))).toBe(true)
    expect(labels.some((l) => /durabilidad al lavado/i.test(l))).toBe(true)
  })

  it("asks attachment method and edge finish for a patch design", () => {
    const fields = fallbackProductionQuestions({ designs: [{ name: "Parche espalda", tec: "Parche Tejido" }] })
    const labels = fields.map((f) => f.label)
    expect(labels.some((l) => /cómo se fija el parche/i.test(l))).toBe(true)
    expect(labels.some((l) => /terminación de borde/i.test(l))).toBe(true)
  })

  it("contracts \"de + el\" so questions read \"del diseño\", not \"de el diseño\"", () => {
    const fields = fallbackProductionQuestions({ designs: [{ name: "Botonadura", tec: "Botones" }] })
    const spacing = fields.find((f) => /distancia/i.test(f.label))
    expect(spacing.label).toContain("del diseño")
    expect(fields.some((f) => /de el /.test(f.label))).toBe(false)
  })

  it("does not let a construction part re-ask what a named design already covers", () => {
    // Live case: a design auto-named "Botones" plus a part "Cierre: Botones"
    // are the same placket - the walk asked "¿Cuántos botones...?" twice.
    const fields = fallbackProductionQuestions({
      designs: [{ name: "Botones", tec: "Botones" }],
      parts: [{ id: "Tipo de cierre", label: "Tipo de cierre", val: "Botones", on: true }],
    })
    expect(fields.filter((f) => /cuántos botones/i.test(f.label))).toHaveLength(1)
    expect(fields.every((f) => !/la pieza/.test(f.label))).toBe(true)
  })

  it("never emits the same question sentence twice across subjects", () => {
    const fields = fallbackProductionQuestions({
      designs: [{ name: "Frente", tec: "Botones" }, { name: "Puno", tec: "Botones" }],
    })
    // the gendered-side question carries no subject, so it must appear once
    expect(fields.filter((f) => /cambia de lado/i.test(f.label))).toHaveLength(1)
    expect(new Set(fields.map((f) => f.label)).size).toBe(fields.length)
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

  it("does not false-positive the hem rule on ordinary position language ('bajo' meaning 'below')", () => {
    // A logo's posDetail routinely reads like "80mm bajo costura de hombro" -
    // "bajo" there means "below", nothing to do with a garment hem. A bare
    // \bbajo\b in the hem regex used to match this and ask an irrelevant
    // hem-width question tied to the LOGO design instead of the actual hem.
    const fields = fallbackProductionQuestions({
      designs: [{ name: "Logo de marca", tec: "Bordado", posDetail: "80mm bajo costura de hombro, centrado" }],
    })
    expect(fields.some((f) => /dobladillo/i.test(f.label))).toBe(false)
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

  it("preserves the original part/design-tied key when the hybrid call round-trips the deterministic fallback as valid JSON", async () => {
    // This is what actually happens live when NVIDIA/Qwen both fail: runHybridAI
    // returns the `fallback` JSON string as-is (it's valid JSON, not garbage),
    // so authorProductionQuestions must recognize these keys are ALREADY
    // fully-qualified ("production:buttons:part:6:count") and must NOT
    // re-prefix them with "production:ai:" - doing so breaks
    // applyReviewAnswers()'s part/design routing and dumps every answer onto
    // the first design's notes instead of the right part.
    deepseekChat.mockImplementation(async ({ fallback }) => fallback)
    const result = await authorProductionQuestions({
      hdr: {},
      parts: [{ id: 6, val: "Botones", on: true }],
      designs: [{ name: "Logo de marca", tec: "Bordado" }],
    })
    const buttonCount = result.find((f) => /cuántos botones/i.test(f.label))
    expect(buttonCount.key).toBe("production:buttons:part:6:count")
    const threadColor = result.find((f) => /color de hilo/i.test(f.label))
    expect(threadColor.key).toMatch(/^production:embroidery:design:/)
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
