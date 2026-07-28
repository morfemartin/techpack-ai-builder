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
    expect(result).toEqual({ machine: "Tajima", stitches: "4800", colorChanges: "2" })
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
})
