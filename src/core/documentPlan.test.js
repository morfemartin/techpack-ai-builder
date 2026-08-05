import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  deepseekChatStream: vi.fn(),
  getTextAIProvider: vi.fn(() => "nvidia"),
  DeepSeekError: class DeepSeekError extends Error {},
}))

import { deepseekChat, deepseekChatStream } from "./deepseekClient.js"
import {
  assignPartsToSections,
  composeOutlineFromSections,
  extractLastCompletedRegionType,
  fallbackDocumentOutline,
  planDocumentOutline,
  planDocumentSections,
  planPageLayout,
  withPlanningTimeout,
} from "./documentPlan.js"

const SECTIONS = [
  { id: "construction", title: "Construccion", purpose: "structure:shell-body", objective: "Definir ensamble", criteria: "Paneles y uniones", views: ["Frente"] },
  { id: "materials", title: "Materiales", purpose: "data:materials", objective: "Definir telas", criteria: "Tela, composicion y gramaje" },
]

describe("document plan AI wrappers", () => {
  beforeEach(() => {
    deepseekChat.mockReset()
    deepseekChatStream.mockReset()
  })

  it("adds a dedicated fabric colorway page before artwork pages", () => {
    const result = fallbackDocumentOutline({
      garmentType: "Hoodie",
      parts: [{ id: "body", label: "Cuerpo", val: "French terry", on: true }],
      designs: [{ name: "Chest Logo", colors: [{ name: "White", hex: "#FFFFFF" }] }],
      fabricColors: [{ name: "Pantone 19-4052 TCX", hex: "#123456" }],
    })
    const purposes = result.pages.map((page) => page.purpose)
    expect(purposes).toContain("data:colorways")
    expect(purposes.indexOf("data:colorways")).toBeLessThan(purposes.indexOf("design:Chest Logo"))
  })

  it("bounds stalled planning calls so the caller can use its fallback", async () => {
    vi.useFakeTimers()
    try {
      const result = withPlanningTimeout(new Promise(() => {}), 25)
      const rejection = expect(result).rejects.toThrow("planning_timeout")
      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it("asks for section purposes using labels but never field values", async () => {
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ sections: SECTIONS }))
    const result = await planDocumentSections({
      garmentType: "Polo",
      parts: [{ id: 1, label: "Gramaje", val: "220 GSM", on: true }],
      lang: "ES",
    })
    const prompt = deepseekChat.mock.calls[0][0].messages[0].content
    expect(prompt).toContain("Gramaje")
    expect(prompt).not.toContain("220 GSM")
    expect(result.sections[0].criteria).toBe("Paneles y uniones")
    expect(deepseekChat.mock.calls[0][0].task).toBe("outline-index")
  })

  it("provides a fallback that satisfies the section contract even when one bucket dominates", async () => {
    const parts = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, label: "Panel " + (index + 1), on: true }))
    deepseekChat.mockImplementationOnce(async (options) => {
      expect(options.validator(options.fallback)).toBe(true)
      return options.fallback
    })
    const result = await planDocumentSections({ garmentType: "Parka", parts, designs: [] })
    expect(result.sections.length).toBeGreaterThanOrEqual(6)
  })

  it("filters cover and design pages out of a model-authored section index", async () => {
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ sections: [
      { id: "cover", title: "Cover", purpose: "cover", objective: "X", criteria: "X" },
      ...SECTIONS,
      { id: "logo", title: "Logo", purpose: "design:Logo", objective: "X", criteria: "X" },
    ] }))
    const result = await planDocumentSections({ garmentType: "Polo", parts: [], designs: [] })
    expect(result.sections.map((section) => section.id)).toEqual(["construction", "materials"])
  })

  it("validates every assignment batch by exact id coverage", async () => {
    const parts = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, label: index ? "Panel" : "Tela", val: "Dato", on: true }))
    const batches = []
    deepseekChat.mockImplementation(async (options) => {
      const match = options.messages[0].content.match(/Lote: (\[[\s\S]*?\])\n\n/)
      const batch = JSON.parse(match[1])
      return JSON.stringify({ asignaciones: batch.map((part) => ({ pieza: String(part.id), seccion: part.id === 1 ? "materials" : "construction" })) })
    })
    const result = await assignPartsToSections(SECTIONS, { parts }, { onBatch: (event) => batches.push(event) })
    expect(result.assignments).toHaveLength(13)
    expect(batches).toEqual([{ index: 1, total: 2, size: 12 }, { index: 2, total: 2, size: 1 }])
    expect(deepseekChat).toHaveBeenCalledTimes(2)
    for (const call of deepseekChat.mock.calls) {
      expect(call[0].task).toBe("outline-assign")
      expect(call[0].validator(call[0].fallback)).toBe(true)
    }
  })

  it("rejects omitted, duplicated, invented, and unknown-section assignments", async () => {
    const parts = [{ id: 1, label: "Tela", on: true }, { id: 2, label: "Panel", on: true }]
    deepseekChat.mockImplementationOnce(async (options) => {
      expect(options.validator('{"asignaciones":[{"pieza":"1","seccion":"materials"}]}')).toBe(false)
      expect(options.validator('{"asignaciones":[{"pieza":"1","seccion":"materials"},{"pieza":"1","seccion":"construction"}]}')).toBe(false)
      expect(options.validator('{"asignaciones":[{"pieza":"1","seccion":"materials"},{"pieza":"3","seccion":"construction"}]}')).toBe(false)
      expect(options.validator('{"asignaciones":[{"pieza":"1","seccion":"unknown"},{"pieza":"2","seccion":"construction"}]}')).toBe(false)
      return options.fallback
    })
    const result = await assignPartsToSections(SECTIONS, { parts })
    expect(result.assignments.map((item) => item.piece).sort()).toEqual(["1", "2"])
  })

  it("composes sections without losing, duplicating, or overloading pieces", () => {
    const parts = Array.from({ length: 17 }, (_, index) => ({ id: index + 1, label: "Panel " + (index + 1), on: true }))
    const assignments = parts.map((part) => ({ piece: String(part.id), section: "construction" }))
    const { outline } = composeOutlineFromSections(SECTIONS, assignments, { garmentType: "Parka", parts, designs: [{ name: "Logo pecho" }] })
    const construction = outline.pages.filter((page) => page.purpose === "structure:shell-body")
    expect(construction.map((page) => page.pieces.length)).toEqual([8, 8, 1])
    expect(construction.flatMap((page) => page.pieces)).toEqual(parts.map((part) => String(part.id)))
    expect(outline.pages.map((page) => page.purpose)).toContain("design:Logo pecho")
  })

  it("preserves a section's objective, criteria, views, and illustration policy", () => {
    const sections = [{ ...SECTIONS[0], illustration: "optional" }]
    const result = composeOutlineFromSections(sections, [{ piece: "1", section: "construction" }], {
      garmentType: "Parka",
      parts: [{ id: 1, label: "Frente", on: true }],
    })
    expect(result.outline.pages[1]).toMatchObject({
      objective: "Definir ensamble",
      criteria: "Paneles y uniones",
      views: ["Frente"],
      illustration: "optional",
    })
  })

  it("normalizes numeric piece ids to strings exactly once", () => {
    const result = composeOutlineFromSections(SECTIONS, [{ piece: 7, section: "construction" }], {
      garmentType: "Polo",
      parts: [{ id: 7, label: "Frente", on: true }],
    })
    expect(result.outline.pages[1].pieces).toEqual(["7"])
  })

  it("repairs an empty or unknown assignment locally instead of failing the document", () => {
    const parts = [{ id: 1, label: "Gramaje", val: "220 GSM", on: true }, { id: 2, label: "Dato raro", val: "Confirmar", on: true }]
    const result = composeOutlineFromSections(SECTIONS, [
      { piece: "1", section: "" },
      { piece: "2", section: "missing-section" },
    ], { garmentType: "Polo", parts, designs: [] })
    const covered = result.outline.pages.flatMap((page) => page.pieces || [])
    expect(covered.sort()).toEqual(["1", "2"])
    expect(result.changes.filter((change) => change.includes("deterministic contract"))).toHaveLength(2)
  })

  it("runs index then assignments and exposes stage telemetry", async () => {
    const parts = [{ id: 1, label: "Tela", val: "Pique", on: true }, { id: 2, label: "Frente", val: "Panel", on: true }]
    deepseekChat
      .mockResolvedValueOnce(JSON.stringify({ sections: SECTIONS }))
      .mockResolvedValueOnce(JSON.stringify({ asignaciones: [{ pieza: "1", seccion: "materials" }, { pieza: "2", seccion: "construction" }] }))
    const events = { sections: null, batches: [], proposal: null }
    const outline = await planDocumentOutline(
      { garmentType: "Polo", parts, designs: [], lang: "ES" },
      {
        onSections: (sections) => { events.sections = sections },
        onBatch: (batch) => events.batches.push(batch),
        onProposal: (proposal) => { events.proposal = proposal },
      }
    )
    expect(deepseekChat).toHaveBeenCalledTimes(2)
    expect(events.sections).toHaveLength(2)
    expect(events.batches).toEqual([{ index: 1, total: 1, size: 2 }])
    expect(events.proposal.assignments).toHaveLength(2)
    expect(outline.pages.filter((page) => page.pieces).flatMap((page) => page.pieces).sort()).toEqual(["1", "2"])
  })

  it("reports a degraded document when any planning stage uses its contract", async () => {
    const parts = [{ id: 1, label: "Tela", val: "Pique", on: true }]
    deepseekChat
      .mockImplementationOnce(async (options) => {
        options.onResult({ provider: "nvidia", model: "deepseek" })
        return JSON.stringify({ sections: SECTIONS })
      })
      .mockImplementationOnce(async (options) => {
        options.onResult({ provider: "contract", model: "deterministic", fallbackReason: "invalid" })
        return options.fallback
      })
    let telemetry
    await planDocumentOutline({ garmentType: "Polo", parts, designs: [] }, { onProposal: (value) => { telemetry = value } })
    expect(telemetry.aiResult).toMatchObject({ provider: "contract", degraded: true })
  })

  it("never ships artwork blobs into section, assignment, or page prompts", async () => {
    const blob = "A".repeat(200000)
    const parts = [{ id: 1, label: "Tela", val: "Pique", on: true }]
    deepseekChat
      .mockResolvedValueOnce(JSON.stringify({ sections: SECTIONS }))
      .mockResolvedValueOnce(JSON.stringify({ asignaciones: [{ pieza: "1", seccion: "materials" }] }))
    await planDocumentOutline({ garmentType: "Polo", parts, designs: [{ name: "Logo", imageData: blob }] })
    expect(deepseekChat.mock.calls.every((call) => !call[0].messages[0].content.includes(blob))).toBe(true)

    deepseekChat.mockReset()
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ regions: [{ type: "header" }, { type: "illustration" }] }))
    await planPageLayout({ id: "d1", title: "Logo", purpose: "design:Logo" }, { designs: [{ name: "Logo", imageData: blob }] })
    expect(deepseekChat.mock.calls[0][0].messages[0].content).not.toContain(blob)
  })

  it("makes the page objective and inclusion criteria binding in the layout prompt", async () => {
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ regions: [{ type: "header" }, { type: "partsList" }] }))
    await planPageLayout(
      { id: "quality", title: "QC", purpose: "data:quality", objective: "Evitar defectos", criteria: "Solo controles verificables" },
      { parts: [] }
    )
    const prompt = deepseekChat.mock.calls[0][0].messages[0].content
    expect(prompt).toContain("Esta pagina existe para: Evitar defectos")
    expect(prompt).toContain("Su criterio de inclusion es: Solo controles verificables")
  })

  it("keeps the deterministic outline available to non-blocking previews", () => {
    const outline = fallbackDocumentOutline({ garmentType: "Hoodie", designs: [{ name: "Back Print" }] })
    expect(outline.pages.map((page) => page.purpose)).toEqual(["cover", "overview", "design:Back Print"])
  })

  it("streams progress, drops unknown regions, and repairs the page contract", async () => {
    const events = []
    deepseekChatStream.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({ contentSoFar: '{"regions":[{"type":"header"', tokensSoFar: 1 })
      onEvent({ contentSoFar: '{"regions":[{"type":"header"},{"type":"bogus"}', tokensSoFar: 2 })
      return '{"regions":[{"type":"header","weight":10},{"type":"bogus","weight":90},{"type":"disclaimer","weight":10}]}'
    })
    const page = await planPageLayout(
      { id: "overview", title: "Overview", purpose: "overview" },
      { garmentType: "Hoodie", parts: [], designs: [], lang: "ES" },
      { onProgress: (event) => events.push(event) }
    )
    expect(page.regions.map((region) => region.type)).toEqual(["header", "titleBar", "illustration", "partsList", "disclaimer"])
    expect(events.at(-1)).toEqual({ percent: 5, lastLabel: "bogus" })
  })

  it("extracts the latest region type from partial JSON", () => {
    expect(extractLastCompletedRegionType('{"type":"header"},{"type":"illustration"')).toBe("illustration")
    expect(extractLastCompletedRegionType("no json yet")).toBe(null)
  })
})
