import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./deepseekClient.js", () => ({ extractStructured: vi.fn() }))
import { extractStructured } from "./deepseekClient.js"
import { buildTranslationPayload, combineTranslations, translateContent, validTranslation } from "./translate.js"

const hdr = { pname: "Chaqueta 20K" }
const parts = [{ on: true, val: "Cierre YKK 5, largo 620mm" }]
const designs = [{ name: "Logo D1", pos: "Pecho", posDetail: "80mm bajo hombro", tec: "Bordado", illustrationBrief: "Marcar DIM-1" }]
const fabricColors = [{ name: "Azul marino", hex: "#1B2A41", pantoneApprox: "19-3921 TCX", pantoneStatus: "approximate" }]

describe("technical translation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("validates cardinality and preserves technical tokens", () => {
    const source = buildTranslationPayload(hdr, parts, designs)
    const translated = structuredClone(source)
    translated.pname = "20K Jacket"
    translated.parts[0] = "YKK 5 zipper, 620mm long"
    expect(validTranslation(source, translated)).toBe(true)
    translated.parts[0] = "YKK zipper"
    expect(validTranslation(source, translated)).toBe(false)
  })

  // Verified live against Mistral: wrapping the payload in {source,
  // previousInvalidAnswer: null} on EVERY attempt made the model mirror that
  // envelope back nested under "source" - 3/3 real translations came back
  // perfectly translated but failed sameKeys() before the content was ever
  // inspected. The first attempt must send the document with no envelope.
  it("sends the first attempt unwrapped - no source/previousInvalidAnswer envelope", async () => {
    const source = buildTranslationPayload(hdr, parts, designs)
    const valid = structuredClone(source)
    valid.pname = "20K Jacket"
    extractStructured.mockResolvedValueOnce(valid)
    await translateContent(hdr, parts, designs, "EN")
    const call = extractStructured.mock.calls[0][0]
    const sent = JSON.parse(call.content)
    expect(Object.keys(sent).sort()).toEqual(["designs", "fabricColors", "lexicon", "parts", "pname"])
    expect(call.instructions).toContain("EXACTLY these top-level keys")
  })

  it("wraps only the repair attempt, with the previous invalid answer alongside the document", async () => {
    const source = buildTranslationPayload(hdr, parts, designs)
    const invalid = { ...source, parts: [] }
    const valid = structuredClone(source)
    valid.pname = "20K Jacket"
    extractStructured.mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid)
    await translateContent(hdr, parts, designs, "EN")
    const secondCall = extractStructured.mock.calls[1][0]
    const sent = JSON.parse(secondCall.content)
    expect(Object.keys(sent).sort()).toEqual(["documentToTranslate", "invalidPreviousAttempt"])
    expect(sent.documentToTranslate).toEqual(source)
    expect(sent.invalidPreviousAttempt).toEqual(invalid)
  })

  it("repairs one invalid answer before failing", async () => {
    const source = buildTranslationPayload(hdr, parts, designs)
    const invalid = { ...source, parts: [] }
    const valid = structuredClone(source)
    valid.pname = "20K Jacket"
    extractStructured.mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid)
    await expect(translateContent(hdr, parts, designs, "EN")).resolves.toEqual(valid)
    expect(extractStructured).toHaveBeenCalledTimes(2)
  })

  it("continues to the repair pass when the provider returns malformed JSON", async () => {
    const source = buildTranslationPayload(hdr, parts, designs)
    const valid = structuredClone(source)
    valid.pname = "20K Jacket"
    extractStructured.mockRejectedValueOnce(new Error("invalid JSON")).mockResolvedValueOnce(valid)
    await expect(translateContent(hdr, parts, designs, "EN")).resolves.toEqual(valid)
    expect(extractStructured).toHaveBeenCalledTimes(2)
  })

  it("blocks a language after repair and a fresh third attempt both fail", async () => {
    extractStructured.mockResolvedValue({ parts: [] })
    await expect(translateContent(hdr, parts, designs, "DE")).rejects.toMatchObject({ code: "translation_contract_failed", language: "DE" })
    expect(extractStructured).toHaveBeenCalledTimes(3)
  })

  it("translates color names while preserving Pantone and hexadecimal references", () => {
    const source = buildTranslationPayload(hdr, parts, designs, "ES", fabricColors)
    const translated = structuredClone(source)
    translated.fabricColors[0].name = "Navy blue"
    expect(validTranslation(source, translated)).toBe(true)
    translated.fabricColors[0].hex = "#FFFFFF"
    expect(validTranslation(source, translated)).toBe(false)
    translated.fabricColors[0].hex = source.fabricColors[0].hex
    translated.fabricColors[0].pantoneStatus = "verified"
    expect(validTranslation(source, translated)).toBe(false)
  })

  it("combines validated translations without duplicating invariant structure", () => {
    const es = buildTranslationPayload(hdr, parts, designs)
    const en = structuredClone(es)
    en.pname = "20K Jacket"
    en.parts[0] = "YKK 5 zipper, 620mm long"
    const combined = combineTranslations({ ES: es, EN: en }, ["ES", "EN"])
    expect(combined.pname).toBe("ES: Chaqueta 20K / EN: 20K Jacket")
    expect(combined.parts).toHaveLength(1)
    expect(combined.languages).toEqual(["ES", "EN"])
  })
})
