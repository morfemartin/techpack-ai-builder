import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChat: vi.fn(),
  DeepSeekError: class DeepSeekError extends Error {},
}))

import { deepseekChat } from "./deepseekClient.js"
import { computeDownscaleDims, parseVisionSeed, extractGarmentFromImages } from "./visionExtract.js"

describe("computeDownscaleDims", () => {
  it("passes through an image already within the max dimension", () => {
    expect(computeDownscaleDims(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })

  it("scales down a landscape image, keeping aspect ratio", () => {
    expect(computeDownscaleDims(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 })
  })

  it("scales down a portrait image, keeping aspect ratio", () => {
    expect(computeDownscaleDims(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 })
  })

  it("scales a square image so both sides hit the cap", () => {
    expect(computeDownscaleDims(3000, 3000, 1000)).toEqual({ width: 1000, height: 1000 })
  })

  it("never upscales", () => {
    expect(computeDownscaleDims(100, 50, 1024)).toEqual({ width: 100, height: 50 })
  })

  it("returns the input unchanged when width or height is missing", () => {
    expect(computeDownscaleDims(0, 0, 1024)).toEqual({ width: 0, height: 0 })
  })
})

describe("parseVisionSeed", () => {
  it("parses a clean JSON response", () => {
    const raw = '{"garmentType":"Camisa","seed":{"Color":"Azul","Cuello":"Clasico"}}'
    expect(parseVisionSeed(raw)).toEqual({ garmentType: "Camisa", seed: { Color: "Azul", Cuello: "Clasico" } })
  })

  it("strips markdown fences before parsing", () => {
    const raw = '```json\n{"garmentType":"Polo","seed":{"Color":"Blanco"}}\n```'
    expect(parseVisionSeed(raw)).toEqual({ garmentType: "Polo", seed: { Color: "Blanco" } })
  })

  it("returns an empty result for malformed JSON", () => {
    expect(parseVisionSeed("esto no es json")).toEqual({ garmentType: "", seed: {} })
  })

  it("defaults seed to an empty object when missing", () => {
    expect(parseVisionSeed('{"garmentType":"Hoodie"}')).toEqual({ garmentType: "Hoodie", seed: {} })
  })

  it("drops non-string and empty-string seed values", () => {
    const raw = '{"garmentType":"Jogger","seed":{"Color":"Negro","Bolsillos":3,"Cierre":"","Notas":null}}'
    expect(parseVisionSeed(raw)).toEqual({ garmentType: "Jogger", seed: { Color: "Negro" } })
  })
})

describe("extractGarmentFromImages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("throws when there are no images", async () => {
    await expect(extractGarmentFromImages([])).rejects.toThrow()
    expect(deepseekChat).not.toHaveBeenCalled()
  })

  it("sends a vision content-block per image and returns the parsed seed", async () => {
    deepseekChat.mockResolvedValue('{"garmentType":"Camisa","seed":{"Color":"Azul"}}')
    const result = await extractGarmentFromImages([{ fileName: "a.jpg", base64: "AAA" }, { fileName: "b.jpg", base64: "BBB" }])

    expect(result).toEqual({ garmentType: "Camisa", seed: { Color: "Azul" } })
    const call = deepseekChat.mock.calls[0][0]
    expect(call.messages[0].content).toHaveLength(3) // 1 text block + 2 images
    expect(call.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } })
    expect(call.model).toMatch(/vision/i)
  })
})
