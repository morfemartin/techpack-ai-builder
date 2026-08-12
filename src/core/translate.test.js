import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./deepseekClient.js", () => ({ extractStructured: vi.fn() }))
import { extractStructured } from "./deepseekClient.js"
import { buildTranslationPayload, combineTranslations, translateContent, validTranslation } from "./translate.js"
import { newPom, newSizeChart } from "./sizeChart.js"

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
    expect(Object.keys(sent).sort()).toEqual(["designs", "fabricColors", "lexicon", "parts", "pname", "sizeChart"])
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

  describe("size chart translation - labels only, never the numbers", () => {
    const chart = newSizeChart({
      poms: [newPom({ label: "Medio pecho", howToMeasure: "2.5 cm bajo la axila", unit: "cm", tolerance: 1, values: { M: 54 } })],
      constants: [{ label: "Altura del cuello", value: 3.5, unit: "cm" }],
    })

    // The safety property this whole feature exists for: a wrong POM number
    // is a garment cut wrong, so the number must be structurally impossible
    // to alter here - not merely "the model was told not to change it".
    it("never puts a POM value, unit or tolerance in the translation payload", () => {
      const source = buildTranslationPayload(hdr, parts, designs, "ES", [], chart)
      const serialized = JSON.stringify(source.sizeChart)
      expect(serialized).not.toContain("54")
      expect(serialized).not.toContain("3.5")
      // The exact-shape check is what actually proves it: only label/
      // howToMeasure survive - unit, tolerance and values are structurally
      // absent, not just empty. howToMeasure is free descriptive text and
      // may legitimately mention "cm" ("2.5 cm bajo la axila") - that is not
      // the stored, authoritative unit field.
      expect(source.sizeChart).toEqual({ poms: [{ label: "Medio pecho", howToMeasure: "2.5 cm bajo la axila" }], constants: [{ label: "Altura del cuello" }] })
    })

    it("validates a translation that only changes the labels", () => {
      const source = buildTranslationPayload(hdr, parts, designs, "ES", [], chart)
      const translated = structuredClone(source)
      translated.sizeChart.poms[0].label = "Half chest"
      translated.sizeChart.poms[0].howToMeasure = "2.5 cm below the armhole"
      translated.sizeChart.constants[0].label = "Neck height"
      expect(validTranslation(source, translated)).toBe(true)
    })

    it("rejects a translation that drops or resizes the POM/constant arrays", () => {
      const source = buildTranslationPayload(hdr, parts, designs, "ES", [], chart)
      const droppedPom = structuredClone(source)
      droppedPom.sizeChart.poms = []
      expect(validTranslation(source, droppedPom)).toBe(false)
      const droppedConstant = structuredClone(source)
      droppedConstant.sizeChart.constants = []
      expect(validTranslation(source, droppedConstant)).toBe(false)
    })

    it("combines sizeChart labels across languages the same way as every other field", () => {
      const es = buildTranslationPayload(hdr, parts, designs, "ES", [], chart)
      const en = structuredClone(es)
      en.sizeChart.poms[0].label = "Half chest"
      en.sizeChart.constants[0].label = "Neck height"
      const combined = combineTranslations({ ES: es, EN: en }, ["ES", "EN"])
      expect(combined.sizeChart.poms[0].label).toBe("ES: Medio pecho / EN: Half chest")
      expect(combined.sizeChart.constants[0].label).toBe("ES: Altura del cuello / EN: Neck height")
    })

    it("defaults to an empty sizeChart when none is given - no regression for documents without one", () => {
      const source = buildTranslationPayload(hdr, parts, designs)
      expect(source.sizeChart).toEqual({ poms: [], constants: [] })
    })
  })
})
