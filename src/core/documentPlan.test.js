import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  deepseekChatStream: vi.fn(),
  DeepSeekError: class DeepSeekError extends Error {},
}))

import { deepseekChat, deepseekChatStream } from "./deepseekClient.js"
import { extractLastCompletedRegionType, planDocumentOutline, planPageLayout } from "./documentPlan.js"

describe("document plan AI wrappers", () => {
  beforeEach(() => {
    deepseekChat.mockReset()
    deepseekChatStream.mockReset()
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

    expect(outline.pages).toEqual([
      { id: "overview-page", title: "Sueter Overview", purpose: "overview", covers: undefined },
      { id: "logo", title: "Logo", purpose: "design:Chest Logo", covers: ["Chest Logo"] },
    ])
    expect(deepseekChat).toHaveBeenCalledOnce()
  })

  it("falls back to overview plus design pages when the outline is empty", async () => {
    deepseekChat.mockResolvedValueOnce('{"pages":[]}')
    const outline = await planDocumentOutline({ garmentType: "Hoodie", designs: [{ name: "Back Print" }] })

    expect(outline.pages.map((p) => p.purpose)).toEqual(["overview", "design:Back Print"])
  })

  it("streams page layout progress and normalizes unknown region types away", async () => {
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

    expect(page.regions.map((r) => r.type)).toEqual(["header", "disclaimer"])
    expect(events.at(-1)).toEqual({ percent: 5, lastLabel: "bogus" })
    expect(deepseekChatStream).toHaveBeenCalledOnce()
  })

  it("extracts the latest region type from partial JSON", () => {
    expect(extractLastCompletedRegionType('{"type":"header"},{"type":"illustration"')).toBe("illustration")
    expect(extractLastCompletedRegionType("no json yet")).toBe(null)
  })
})
