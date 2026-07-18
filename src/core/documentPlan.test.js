import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  deepseekChatStream: vi.fn(),
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
