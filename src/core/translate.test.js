import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./deepseekClient.js", () => ({ extractStructured: vi.fn() }))
import { extractStructured } from "./deepseekClient.js"
import { buildTranslationPayload, combineTranslations, translateContent, translationContractIssues, validTranslation } from "./translate.js"
import { buildCustomGarment, mapChatDesignsToDesigns } from "../garments/buildCustomGarment.js"
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

  it("accepts the Turkish percent position without relaxing the numeric value", () => {
    const percentParts = [{ on: true, val: "100% Poliester" }]
    const source = buildTranslationPayload(hdr, percentParts, [])
    const translated = structuredClone(source)
    translated.parts[0] = "%100 Polyester"
    expect(validTranslation(source, translated)).toBe(true)
    translated.parts[0] = "%90 Polyester"
    expect(validTranslation(source, translated)).toBe(false)
  })

  it("keeps production tokens outside the model translation and restores them exactly", async () => {
    const percentParts = [{ on: true, val: "100% Poliester, 220gsm, DIM-1, V1.1" }]
    extractStructured.mockImplementation(async ({ content }) => {
      const payload = JSON.parse(content)
      return {
        items: payload.items.map((item) => ({
          ...item,
          text: item.text.replace("Poliester", "Polyester"),
        })),
      }
    })

    const translated = await translateContent(hdr, percentParts, [], "TR")
    const protectedItem = extractStructured.mock.calls
      .flatMap(([call]) => JSON.parse(call.content).items)
      .find((item) => item.id === "part-value:0")

    expect(protectedItem.text).toBe("__TECH_A__ Poliester, __TECH_B__, __TECH_C__, __TECH_D__")
    expect(protectedItem.text).not.toContain("100%")
    expect(translated.parts[0]).toBe("100% Polyester, 220gsm, DIM-1, V1.1")
  })

  it("translates a large AI-created garment without asking the model to rebuild Turkish document chrome", async () => {
    const draft = {
      label: "Polo tecnico de manga corta",
      parts: Array.from({ length: 44 }, (_, index) => ({
        label: "Dato tecnico " + (index + 1),
        val: index === 0 ? "100% Poliester, 220gsm" : "Construccion confirmada " + (index + 1) + ", DIM-" + (index + 1) + " 43mm",
      })),
      positions: ["Pecho izquierdo"],
      designs: [{ name: "Logo reflectivo", pos: "Pecho izquierdo", tec: "Bordado plano", illustrationBrief: "Marcar V1.1 y DIM-1 43mm" }],
    }
    const garment = buildCustomGarment(draft)
    const customParts = garment.defaultParts
    const customDesigns = mapChatDesignsToDesigns(draft.designs, garment.positions.ES[0])
    const customLabels = customParts.map((part) => garment.partLabels.ES[part.id])

    extractStructured.mockImplementation(async ({ content }) => {
      const payload = JSON.parse(content)
      return {
        items: payload.items.map((item) => ({
          ...item,
          text: item.text
            .replaceAll("Polo tecnico de manga corta", "Kısa kollu teknik polo")
            .replaceAll("Dato tecnico", "Teknik veri")
            .replaceAll("Construccion confirmada", "Onaylanmış yapı")
            .replaceAll("Pecho izquierdo", "Sol göğüs")
            .replaceAll("Bordado plano", "Düz nakış")
            .replaceAll("Marcar", "İşaretle"),
        })),
      }
    })

    const translated = await translateContent(
      { pname: draft.label },
      customParts,
      customDesigns,
      "TR",
      { partLabels: customLabels }
    )

    const sentItems = extractStructured.mock.calls.flatMap(([call]) => JSON.parse(call.content).items)
    expect(sentItems).toHaveLength(44 * 2 + 4)
    expect(sentItems.some((item) => item.id.startsWith("lexicon:"))).toBe(false)
    expect(translated.parts).toHaveLength(44)
    expect(translated.partLabels[43]).toBe("Teknik veri 44")
    expect(translated.designs[0]).toMatchObject({ pos: "Sol göğüs", technique: "Düz Nakış" })
    expect(sentItems.some((item) => item.id === "design:0:technique")).toBe(false)
    expect(translated.lexicon.pending).toBe("ONAY BEKLİYOR")
    expect(validTranslation(buildTranslationPayload({ pname: draft.label }, customParts, customDesigns, "ES", [], null, customLabels), translated)).toBe(true)
  })

  it("reports the exact custom-garment field that violates the contract", () => {
    const source = buildTranslationPayload(hdr, parts, designs)
    const translated = structuredClone(source)
    translated.parts[0] = "YKK fermuar"
    expect(translationContractIssues(source, translated)).toContain("document.parts[0]: technical tokens changed")
  })

  it("sends a stable id/text catalog instead of asking the model to reproduce the document JSON", async () => {
    extractStructured.mockImplementationOnce(async ({ content }) => JSON.parse(content))
    await translateContent(hdr, parts, designs, "EN")
    const call = extractStructured.mock.calls[0][0]
    const sent = JSON.parse(call.content)
    expect(Object.keys(sent)).toEqual(["items"])
    expect(sent.items.every((item) => Object.keys(item).sort().join(",") === "id,text")).toBe(true)
    expect(sent.items.map((item) => item.id)).toContain("part-value:0")
    expect(call.instructions).toContain("Keep every item id")
  })

  it("retries the same small catalog from the intact source after an invalid answer", async () => {
    extractStructured.mockResolvedValueOnce({ items: [] }).mockImplementationOnce(async ({ content }) => JSON.parse(content))
    await translateContent(hdr, parts, designs, "EN")
    const secondCall = extractStructured.mock.calls[1][0]
    const sent = JSON.parse(secondCall.content)
    expect(Object.keys(sent)).toEqual(["items"])
    expect(secondCall.instructions).toContain("previous response failed")
  })

  it("repairs one invalid answer before failing", async () => {
    extractStructured.mockResolvedValueOnce({ items: [] }).mockImplementationOnce(async ({ content }) => JSON.parse(content))
    await expect(translateContent(hdr, parts, designs, "EN")).resolves.toMatchObject({ parts: [parts[0].val] })
    expect(extractStructured).toHaveBeenCalledTimes(2)
  })

  it("continues to the repair pass when the provider returns malformed JSON", async () => {
    extractStructured.mockRejectedValueOnce(new Error("invalid JSON")).mockImplementationOnce(async ({ content }) => JSON.parse(content))
    await expect(translateContent(hdr, parts, designs, "EN")).resolves.toMatchObject({ parts: [parts[0].val] })
    expect(extractStructured).toHaveBeenCalledTimes(2)
  })

  it("blocks a language after the smallest recoverable batch fails twice", async () => {
    extractStructured.mockResolvedValue({ items: [] })
    await expect(translateContent({ pname: "Camisa" }, [], [], "EN")).rejects.toMatchObject({ code: "translation_contract_failed", language: "EN" })
    expect(extractStructured).toHaveBeenCalledTimes(2)
  })

  it("splits large documents into bounded translations and validates the assembled result", async () => {
    const manyParts = Array.from({ length: 50 }, (_, index) => ({ on: true, val: "Pieza " + (index + 1) + " - 20mm" }))
    extractStructured.mockImplementation(async ({ content }) => {
      const parsed = JSON.parse(content)
      return structuredClone(parsed.documentToTranslate || parsed)
    })

    const translated = await translateContent(hdr, manyParts, designs, "EN")

    expect(translated.parts).toHaveLength(50)
    expect(extractStructured).toHaveBeenCalledTimes(3)
    const batches = extractStructured.mock.calls.map(([call]) => JSON.parse(call.content).items)
    expect(batches.every((items) => items.length <= 24)).toBe(true)
    expect(batches.flat().map((item) => item.id)).toContain("part-value:49")
    expect(extractStructured.mock.calls.every(([call]) => call.maxTokens === 2400)).toBe(true)
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
