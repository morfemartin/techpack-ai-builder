import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  deepseekChatStream: vi.fn(),
  getTextAIProvider: vi.fn(() => "nvidia"),
  DeepSeekError: class DeepSeekError extends Error {},
}))

import { deepseekChat, deepseekChatStream } from "./deepseekClient.js"
import { extractLastCompletedRegionType, fallbackDocumentOutline, planDocumentOutline, planPageLayout, withPlanningTimeout } from "./documentPlan.js"

describe("document plan AI wrappers", () => {
  beforeEach(() => {
    deepseekChat.mockReset()
    deepseekChatStream.mockReset()
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

  it("normalizes an outline response into page descriptors", async () => {
    deepseekChat.mockResolvedValueOnce(
      JSON.stringify({
        pages: [
          { id: "Overview Page", title: "Sueter Overview", purpose: "overview" },
          { title: "Logo", purpose: "design:Chest Logo", covers: ["Chest Logo", ""] },
        ],
      })
    )

    const outline = await planDocumentOutline({
      garmentType: "Sueter",
      parts: [{ label: "Tela", val: "Fleece" }],
      designs: [{ name: "Chest Logo" }],
      lang: "ES",
    })

    // The document contract (repairOutline) inserts the missing cover page
    // in front of whatever the model proposed.
    expect(outline.pages).toEqual([
      { id: "cover", title: "Sueter", purpose: "cover" },
      { id: "overview-page", title: "Sueter Overview", purpose: "overview", covers: undefined },
      { id: "logo", title: "Logo", purpose: "design:Chest Logo", covers: ["Chest Logo"] },
    ])
    expect(deepseekChat).toHaveBeenCalledOnce()
  })

  it("preserves semantic objectives and views proposed for distributed construction pages", async () => {
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ pages: [{
      id: "hood-system",
      title: "Capucha",
      purpose: "structure:hood-neck",
      objective: "Documentar montaje de capucha",
      pieces: ["hood"],
      views: ["Exterior", "Interior"],
    }] }))
    const outline = await planDocumentOutline({ garmentType: "Hoodie", parts: [{ id: "hood", on: true }], designs: [] })
    const page = outline.pages.find((item) => item.id === "hood-system")
    expect(page.objective).toBe("Documentar montaje de capucha")
    expect(page.views).toEqual(["Exterior", "Interior"])
    expect(page.pieces).toEqual(["hood"])
  })

  it("asks the model to subdivide overloaded systems by construction objective", async () => {
    const parts = Array.from({ length: 9 }, (_, index) => ({ id: "P" + String(index + 1).padStart(2, "0"), label: "Piece " + (index + 1), on: true }))
    deepseekChat
      .mockResolvedValueOnce(JSON.stringify({ pages: [{ id: "pockets", title: "Pocket system", purpose: "structure:pockets", pieces: parts.map((part) => part.id) }] }))
      .mockResolvedValueOnce(JSON.stringify({ pages: [
        { id: "pocket-openings", title: "Pocket openings", purpose: "structure:pockets-openings", objective: "Build openings", pieces: parts.slice(0, 6).map((part) => part.id), views: ["Exterior"] },
        { id: "pocket-bags", title: "Pocket bags", purpose: "pockets-bags", objective: "Close pocket bags", pieces: parts.slice(6).map((part) => part.id), views: ["Interior"] },
      ] }))

    let telemetry
    const outline = await planDocumentOutline({ garmentType: "Cargo", parts, designs: [] }, { onProposal: (value) => { telemetry = value } })
    const structural = outline.pages.filter((page) => page.purpose.startsWith("structure:"))

    expect(structural.map((page) => page.pieces.length)).toEqual([6, 3])
    expect(structural.map((page) => page.objective)).toEqual(["Build openings", "Close pocket bags"])
    expect(structural[1].purpose).toBe("structure:pockets")
    expect(telemetry.refinements).toMatchObject([{ pageId: "pockets", accepted: true }])
    expect(deepseekChat).toHaveBeenCalledTimes(2)
  })

  it("uses the deterministic subdivision after one invalid model attempt", async () => {
    const parts = Array.from({ length: 9 }, (_, index) => ({ id: "P" + (index + 1), on: true }))
    const overloaded = { pages: [{ id: "body", title: "Body", purpose: "structure:body", pieces: parts.map((part) => part.id) }] }
    deepseekChat
      .mockResolvedValueOnce(JSON.stringify(overloaded))
      .mockResolvedValueOnce(JSON.stringify({ pages: [{ id: "bad", title: "Bad", purpose: "structure:body", pieces: ["P1", "P1"] }] }))

    let telemetry
    const outline = await planDocumentOutline({ garmentType: "Cargo", parts, designs: [] }, { onProposal: (value) => { telemetry = value } })

    expect(outline.pages.filter((page) => page.purpose.startsWith("structure:")).map((page) => page.id)).toEqual(["body-1", "body-2"])
    expect(telemetry.refinements[0].attempts.map((attempt) => attempt.accepted)).toEqual([false])
    expect(deepseekChat).toHaveBeenCalledTimes(2)
  })

  it("returns an omitted piece to its structural system before deciding pagination", async () => {
    const parts = Array.from({ length: 9 }, (_, index) => ({ id: "P" + (index + 1), system: "upper-body", on: true }))
    deepseekChat
      .mockResolvedValueOnce(JSON.stringify({ pages: [{ id: "upper", title: "Upper", purpose: "structure:upper-body", pieces: parts.slice(0, 8).map((part) => part.id) }] }))
      .mockResolvedValueOnce(JSON.stringify({ pages: [
        { id: "upper-shell", title: "Upper shell", purpose: "structure:upper-body", pieces: parts.slice(0, 6).map((part) => part.id) },
        { id: "seat", title: "Seat", purpose: "structure:upper-body", pieces: parts.slice(6).map((part) => part.id) },
      ] }))

    let telemetry
    const outline = await planDocumentOutline({ garmentType: "Cargo", parts, designs: [] }, { onProposal: (value) => { telemetry = value } })

    expect(outline.pages.filter((page) => page.purpose.startsWith("structure:")).map((page) => page.pieces)).toEqual([
      ["P1", "P2", "P3", "P4", "P5", "P6"],
      ["P7", "P8", "P9"],
    ])
    expect(telemetry.repairs).toContain("restored P9 to upper before semantic refinement")
    expect(telemetry.refinements[0].accepted).toBe(true)
  })

  it("gives the model the confirmed textile brief instead of only names and parts", async () => {
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ pages: [{ id: "cover", title: "Cargo", purpose: "cover" }] }))
    await planDocumentOutline({
      garmentType: "Cargo",
      parts: [{ id: "P01", on: true }],
      designs: [],
      brief: { construction: { seams: ["Safety stitch 516"] }, openPoints: ["Zipper lengths"] },
    })
    const prompt = deepseekChat.mock.calls[0][0].messages[0].content
    expect(prompt).toContain("Brief textil confirmado")
    expect(prompt).toContain("Safety stitch 516")
    expect(prompt).toContain("Zipper lengths")
  })

  it("exposes the model proposal separately from deterministic contract repairs", async () => {
    deepseekChat.mockResolvedValueOnce(JSON.stringify({ pages: [{ id: "body", title: "Body", purpose: "overview", pieces: ["P01"] }] }))
    let telemetry
    const outline = await planDocumentOutline(
      { garmentType: "Cargo", parts: [{ id: "P01", on: true }], designs: [] },
      { onProposal: (value) => { telemetry = value } }
    )
    expect(telemetry.raw).toContain('"body"')
    expect(telemetry.proposed.pages[0].purpose).toBe("overview")
    expect(telemetry.repairs).toContain("inserted cover page")
    expect(outline.pages[0].purpose).toBe("cover")
  })

  it("falls back to cover + overview plus design pages when the outline is empty", async () => {
    deepseekChat.mockResolvedValueOnce('{"pages":[]}')
    const outline = await planDocumentOutline({ garmentType: "Hoodie", designs: [{ name: "Back Print" }] })

    expect(outline.pages.map((p) => p.purpose)).toEqual(["cover", "overview", "design:Back Print"])
  })

  it("exposes the same contract-repaired fallback outline for non-blocking labs", () => {
    const outline = fallbackDocumentOutline({ garmentType: "Hoodie", designs: [{ name: "Back Print" }] })

    expect(outline.pages.map((p) => p.purpose)).toEqual(["cover", "overview", "design:Back Print"])
  })

  it("streams progress, drops unknown region types, and repairs the page to its purpose contract", async () => {
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

    // "bogus" dropped by normalizePlan; the overview contract then inserts
    // the missing mandatory regions (titleBar, illustration, partsList) and
    // enforces canonical chrome order.
    expect(page.regions.map((r) => r.type)).toEqual(["header", "titleBar", "illustration", "partsList", "disclaimer"])
    expect(events.at(-1)).toEqual({ percent: 5, lastLabel: "bogus" })
    expect(deepseekChatStream).toHaveBeenCalledOnce()
  })

  it("extracts the latest region type from partial JSON", () => {
    expect(extractLastCompletedRegionType('{"type":"header"},{"type":"illustration"')).toBe("illustration")
    expect(extractLastCompletedRegionType("no json yet")).toBe(null)
  })
})
