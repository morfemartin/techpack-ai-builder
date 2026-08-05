import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  getLocalOcrText: vi.fn(),
  extractStructured: vi.fn(),
  getTextAIProvider: vi.fn(),
}))

import { getLocalOcrText, extractStructured, getTextAIProvider } from "./deepseekClient.js"
import { extractEmbFromPDF, EmbExtractError } from "./embExtract.js"

describe("extractEmbFromPDF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("refuses immediately on the public build, before ever calling the network", async () => {
    getTextAIProvider.mockReturnValue("nvidia")
    await expect(extractEmbFromPDF("QUJD")).rejects.toThrow(EmbExtractError)
    expect(getLocalOcrText).not.toHaveBeenCalled()
  })

  it("runs the OCR-then-extract pipeline on the studio build", async () => {
    getTextAIProvider.mockReturnValue("local")
    getLocalOcrText.mockResolvedValue("Stitches: 4800\nColors: 2\nMachine: Tajima")
    extractStructured.mockResolvedValue({ machine: "Tajima", stitches: "4800", colorChanges: "2" })

    const result = await extractEmbFromPDF("QUJD")

    expect(getLocalOcrText).toHaveBeenCalledWith("QUJD")
    expect(extractStructured).toHaveBeenCalledOnce()
    const call = extractStructured.mock.calls[0][0]
    expect(call.content).toContain("Stitches: 4800")
    expect(call.instructions).toContain("machine")
    expect(result).toEqual({ emb: { machine: "Tajima", stitches: "4800", colorChanges: "2" }, corrections: [] })
  })

  it("throws instead of silently returning nothing when OCR finds no legible text", async () => {
    getTextAIProvider.mockReturnValue("local")
    getLocalOcrText.mockResolvedValue("   ")
    await expect(extractEmbFromPDF("QUJD")).rejects.toThrow(EmbExtractError)
    expect(extractStructured).not.toHaveBeenCalled()
  })

  it("propagates a real OCR failure (e.g. bridge down, not Mistral-backed) instead of swallowing it", async () => {
    getTextAIProvider.mockReturnValue("local")
    getLocalOcrText.mockRejectedValue(new Error("OCR requires Mistral"))
    await expect(extractEmbFromPDF("QUJD")).rejects.toThrow("OCR requires Mistral")
  })

  // The Wilcom worksheet already states a thread code/name per stop - this
  // reconciles it against the official Madeira chart instead of leaving
  // whatever a human typed on the source document, which can be wrong (see
  // madeiraThreads.test.js: a real production doc claimed code 1055 was
  // "Old Gold", but Madeira's own chart says 1055 is "Latte").
  it("canonicalizes an extracted stopSeq against the Madeira chart and reports what changed", async () => {
    getTextAIProvider.mockReturnValue("local")
    getLocalOcrText.mockResolvedValue("thread chart text")
    extractStructured.mockResolvedValue({
      stopSeq: [
        { stop: 1, color: "", stitches: "4200", code: "1055", name: "Old Gold" },
        { stop: 2, color: "", stitches: "1800", code: "", name: "Onyx" },
      ],
    })

    const result = await extractEmbFromPDF("QUJD")

    expect(result.emb.stopSeq).toEqual([
      { stop: 1, color: "", stitches: "4200", code: "1055", name: "Latte" },
      { stop: 2, color: "", stitches: "1800", code: "1199", name: "Onyx" },
    ])
    expect(result.corrections).toEqual([
      { stop: 1, extractedCode: "1055", extractedName: "Old Gold", officialCode: "1055", officialName: "Latte" },
      { stop: 2, extractedCode: "", extractedName: "Onyx", officialCode: "1199", officialName: "Onyx" },
    ])
  })

  it("leaves stopSeq untouched when nothing matches the Madeira chart", async () => {
    getTextAIProvider.mockReturnValue("local")
    getLocalOcrText.mockResolvedValue("thread chart text")
    const stopSeq = [{ stop: 1, color: "", stitches: "500", code: "9999", name: "Not A Real Thread" }]
    extractStructured.mockResolvedValue({ stopSeq })

    const result = await extractEmbFromPDF("QUJD")

    expect(result.emb.stopSeq).toEqual(stopSeq)
    expect(result.corrections).toEqual([])
  })
})
