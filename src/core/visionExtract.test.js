import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  deepseekChatStream: vi.fn(),
  DeepSeekError: class DeepSeekError extends Error {},
}))

import { deepseekChatStream } from "./deepseekClient.js"
import { computeDownscaleDims, parseVisionSeed, mergeVisionSeeds, summarizeVisionProgress, extractGarmentFromImages, quadrantRects, answerFieldFromImage, answerFieldFromImageSegments, resetVisionConcurrencyForTests } from "./visionExtract.js"

// Two pieces of state leak between cases in this file, and both changed
// results silently rather than failing where the bug was:
//
//  1. vi.clearAllMocks() (used in the describe-level hooks) resets recorded
//     CALLS but not queued one-shot implementations. A case that queues more
//     mockImplementationOnce values than the run actually consumes leaves the
//     surplus in the queue, and the NEXT case silently eats it as its first
//     reply. That is what broke the two photo-grouped cases: one inherited a
//     stray reply and lost its own last seed, the other inherited a truthy
//     garmentType, which skips the classification pass and drops the call
//     count from 8 to 7.
//  2. currentVisionConcurrency self-drops to 1 on a 503 and stays there by
//     design, so whichever case simulates a 503 serialized every case after it.
beforeEach(() => {
  deepseekChatStream.mockReset()
  resetVisionConcurrencyForTests()
})

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

describe("mergeVisionSeeds", () => {
  it("keeps the first non-empty garmentType across results", () => {
    const merged = mergeVisionSeeds([{ garmentType: "", seed: {} }, { garmentType: "Camisa", seed: {} }, { garmentType: "Polo", seed: {} }])
    expect(merged.garmentType).toBe("Camisa")
  })

  it("lets a later photo add a key an earlier one missed, without overwriting existing keys", () => {
    const merged = mergeVisionSeeds([{ garmentType: "Camisa", seed: { Color: "Azul" } }, { garmentType: "Camisa", seed: { Color: "Rojo", Cierre: "Botones" } }])
    expect(merged.seed).toEqual({ Color: "Azul", Cierre: "Botones" }) // first photo's Color wins, second's new key still folds in
  })

  it("returns empty garmentType/seed when every result is empty", () => {
    expect(mergeVisionSeeds([{ garmentType: "", seed: {} }])).toEqual({ garmentType: "", seed: {} })
  })
})

describe("summarizeVisionProgress", () => {
  it("strips fences, collapses whitespace, and truncates long partial text", () => {
    const text = "```json\n" + "x".repeat(180) + "\n```"
    const summary = summarizeVisionProgress(text)
    expect(summary).toHaveLength(140)
    expect(summary.endsWith("...")).toBe(true)
    expect(summary).not.toContain("```")
  })
})

describe("extractGarmentFromImages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("throws when there are no images", async () => {
    await expect(extractGarmentFromImages([])).rejects.toThrow()
    expect(deepseekChatStream).not.toHaveBeenCalled()
  })

  it("streams one single-image call for a single photo and returns the parsed seed", async () => {
    deepseekChatStream.mockResolvedValue('{"garmentType":"Camisa","seed":{"Color":"Azul"}}')
    const result = await extractGarmentFromImages([{ fileName: "a.jpg", base64: "AAA" }])

    expect(result).toEqual({ garmentType: "Camisa", seed: { Color: "Azul" } })
    expect(deepseekChatStream).toHaveBeenCalledTimes(1)
    const call = deepseekChatStream.mock.calls[0][0]
    expect(call.messages[0].content).toHaveLength(2) // 1 text block + 1 image
    expect(call.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } })
    expect(call.model).toMatch(/vision/i)
  })

  it("emits per-photo progress from streamed content", async () => {
    const events = []
    deepseekChatStream.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({ contentSoFar: '{"garmentType":"Camisa"', deltaText: '"Camisa"', tokensSoFar: 3 })
      return '{"garmentType":"Camisa","seed":{"Color":"Azul"}}'
    })

    await extractGarmentFromImages([{ fileName: "a.jpg", base64: "AAA" }], { onProgress: (event) => events.push(event) })

    expect(events[0].imageNumber).toBe(1)
    expect(events[0].total).toBe(1)
    expect(events[0].label).toBe("Analizando foto 1 de 1...")
    expect(events[0].partialText).toContain("Camisa")
  })

  // NVIDIA's vision model only accepts one image per request ("At most 1
  // image(s) may be provided in one request", confirmed live) - a multi-photo
  // upload must fan out into one call per photo instead of one call carrying
  // every image, or the whole request gets rejected.
  it("sends one call per photo (never bundles multiple images into one request) and merges the results", async () => {
    deepseekChatStream
      .mockResolvedValueOnce('{"garmentType":"Camisa","seed":{"Color":"Azul"}}')
      .mockResolvedValueOnce('{"garmentType":"Camisa","seed":{"Cierre":"Botones"}}')

    const result = await extractGarmentFromImages([{ fileName: "a.jpg", base64: "AAA" }, { fileName: "b.jpg", base64: "BBB" }])

    expect(result).toEqual({ garmentType: "Camisa", seed: { Color: "Azul", Cierre: "Botones" } })
    expect(deepseekChatStream).toHaveBeenCalledTimes(2)
    for (const call of deepseekChatStream.mock.calls) {
      expect(call[0].messages[0].content).toHaveLength(2) // never more than 1 image per call
    }
  })

  it("caps concurrent vision calls at 3 even for legacy flat images", async () => {
    let active = 0
    let maxActive = 0
    deepseekChatStream.mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return '{"garmentType":"","seed":{}}'
    })

    const images = Array.from({ length: 7 }, (_, i) => ({ fileName: "photo-" + i + ".jpg", base64: "IMG" + i }))
    await extractGarmentFromImages(images)

    expect(deepseekChatStream).toHaveBeenCalledTimes(7)
    expect(maxActive).toBeLessThanOrEqual(3)
  })

  describe("photo-grouped (quadrant-tagged) images", () => {
    it("processes photo groups in order, full-before-quadrants within a photo, and merges everything", async () => {
      deepseekChatStream
        .mockResolvedValueOnce('{"garmentType":"Hoodie","seed":{"Color":"Negro"}}') // photo 0 full
        .mockResolvedValueOnce('{"garmentType":"","seed":{}}') // photo 0 construction audit
        .mockResolvedValueOnce('{"garmentType":"","seed":{}}') // photo 0 verification
        .mockResolvedValueOnce('{"garmentType":"","seed":{"Costura":"Doble pespunte"}}') // photo 0 quadrant
        .mockResolvedValueOnce('{"garmentType":"","seed":{"Cierre":"Metal"}}') // photo 1 full (no type - shouldn't matter, photo 0 already won)
        .mockResolvedValueOnce('{"garmentType":"","seed":{}}') // photo 1 construction audit
        .mockResolvedValueOnce('{"garmentType":"","seed":{}}') // photo 1 verification

      const images = [
        { fileName: "a.jpg", base64: "AAA", photoIndex: 0, photoTotal: 2, kind: "full" },
        { fileName: "a.jpg", base64: "AAA-q1", photoIndex: 0, photoTotal: 2, kind: "quadrant", quadrantLabel: "superior izquierdo" },
        { fileName: "b.jpg", base64: "BBB", photoIndex: 1, photoTotal: 2, kind: "full" },
      ]
      const result = await extractGarmentFromImages(images)

      expect(result).toEqual({ garmentType: "Hoodie", seed: { Color: "Negro", Costura: "Doble pespunte", Cierre: "Metal" } })
      // photo 0 (type from identity, 1 quadrant): identity+orientation+
      // construction+verification+artwork + 1 quadrant = 6; photo 1 (no type,
      // no quadrant): identity+classification+orientation+construction+
      // verification+artwork = 6. Total 12 (was 14 before dropping `surface`).
      expect(deepseekChatStream).toHaveBeenCalledTimes(12)
    })

    it("labels progress relative to the PHOTO, not the flat array index, and includes the quadrant name", async () => {
      const events = []
      deepseekChatStream
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"Hoodie","seed":{}}'
        })
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"","seed":{}}'
        })
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"","seed":{}}'
        })
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"","seed":{}}'
        })
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"","seed":{}}'
        })
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"","seed":{}}'
        })
        .mockImplementationOnce(async ({ onEvent }) => {
          onEvent({ contentSoFar: "", tokensSoFar: 1 })
          return '{"garmentType":"","seed":{}}'
        })

      const images = [
        { fileName: "a.jpg", base64: "AAA", photoIndex: 0, photoTotal: 1, kind: "full" },
        { fileName: "a.jpg", base64: "AAA-q1", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "superior izquierdo" },
      ]
      await extractGarmentFromImages(images, { onProgress: (e) => events.push(e) })

      expect(events[0].label).toBe("Analizando foto 1 de 1...")
      expect(events[1].label).toBe("Confirmando orientacion de la foto 1 de 1...")
      expect(events[2].label).toBe("Verificando construccion de la foto 1 de 1...")
      expect(events[3].label).toBe("Validando detalles criticos de la foto 1 de 1...")
      expect(events[4].label).toBe("Revisando disenos visibles de la foto 1 de 1...")
      expect(events[5].label).toBe("Analizando foto 1 de 1 - detalle superior izquierdo...")
    })

    it("still behaves exactly as the flat/legacy path when no image carries a photoIndex", async () => {
      deepseekChatStream
        .mockResolvedValueOnce('{"garmentType":"Camisa","seed":{"Color":"Azul"}}')
        .mockResolvedValueOnce('{"garmentType":"Camisa","seed":{"Cierre":"Botones"}}')
      const result = await extractGarmentFromImages([{ fileName: "a.jpg", base64: "AAA" }, { fileName: "b.jpg", base64: "BBB" }])
      expect(result).toEqual({ garmentType: "Camisa", seed: { Color: "Azul", Cierre: "Botones" } })
    })

    it("caps each photo's full+quadrants at 3 concurrent calls", async () => {
      let active = 0
      let maxActive = 0
      deepseekChatStream.mockImplementation(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return '{"garmentType":"","seed":{}}'
      })

      const images = [
        { fileName: "a.jpg", base64: "AAA", photoIndex: 0, photoTotal: 1, kind: "full" },
        { fileName: "a.jpg", base64: "AAA-q1", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "superior izquierdo" },
        { fileName: "a.jpg", base64: "AAA-q2", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "superior derecho" },
        { fileName: "a.jpg", base64: "AAA-q3", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "inferior izquierdo" },
        { fileName: "a.jpg", base64: "AAA-q4", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "inferior derecho" },
      ]
      await extractGarmentFromImages(images)

      // identity returns a type here (mock default has garmentType "") → so
      // classification also runs: identity+classification+orientation+
      // construction+verification+artwork = 6 full, + 2 quadrants (4 provided,
      // capped to VISION_MAX_QUADRANTS) = 8 (was 11).
      expect(deepseekChatStream).toHaveBeenCalledTimes(8)
      expect(maxActive).toBeLessThanOrEqual(3)
    })

    it("keeps full-image priority even when a quadrant finishes first", async () => {
      deepseekChatStream.mockImplementation(async ({ messages }) => {
        const url = messages[0].content[1].image_url.url
        if (url.includes("AAA-full")) {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return '{"garmentType":"Hoodie","seed":{"Color":"Negro"}}'
        }
        return '{"garmentType":"","seed":{"Color":"Gris","Costura":"Pespunte visible"}}'
      })

      const result = await extractGarmentFromImages([
        { fileName: "a.jpg", base64: "AAA-full", photoIndex: 0, photoTotal: 1, kind: "full" },
        { fileName: "a.jpg", base64: "AAA-q1", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "superior izquierdo" },
      ])

      expect(result).toEqual({ garmentType: "Hoodie", seed: { Color: "Negro", Costura: "Pespunte visible" } })
    })

    it("keeps the full-image result when one quadrant fails", async () => {
      deepseekChatStream
        .mockResolvedValueOnce('{"garmentType":"Hoodie","seed":{"Color":"Negro"}}')
        .mockRejectedValueOnce(Object.assign(new Error("capacity"), { status: 503 }))
        .mockResolvedValueOnce('{"garmentType":"","seed":{}}')
        .mockResolvedValueOnce('{"garmentType":"","seed":{"Costura":"Doble"}}')
        .mockResolvedValueOnce('{"garmentType":"","seed":{}}')
      const result = await extractGarmentFromImages([
        { fileName: "a.jpg", base64: "full", photoIndex: 0, photoTotal: 1, kind: "full" },
        { fileName: "a.jpg", base64: "q1", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "superior izquierdo" },
        { fileName: "a.jpg", base64: "q2", photoIndex: 0, photoTotal: 1, kind: "quadrant", quadrantLabel: "superior derecho" },
      ])
      expect(result).toEqual({ garmentType: "Hoodie", seed: { Color: "Negro", Costura: "Doble" } })
      expect(deepseekChatStream.mock.calls.every(([options]) => options.provider === "nvidia" && [15000, 30000].includes(options.timeoutMs))).toBe(true)
    })
  })
})

describe("quadrantRects", () => {
  it("splits into 4 equal quarters covering the whole image with no gaps", () => {
    const rects = quadrantRects(200, 100)
    expect(rects).toHaveLength(4)
    expect(rects.map((r) => [r.sx, r.sy, r.sWidth, r.sHeight])).toEqual([
      [0, 0, 100, 50],
      [100, 0, 100, 50],
      [0, 50, 100, 50],
      [100, 50, 100, 50],
    ])
  })

  it("gives each quadrant a distinct, human-readable Spanish label", () => {
    const labels = quadrantRects(100, 100).map((r) => r.quadrantLabel)
    expect(new Set(labels).size).toBe(4)
    labels.forEach((l) => expect(typeof l).toBe("string"))
  })
})

describe("answerFieldFromImage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends exactly one vision call and returns a trimmed plain-text answer", async () => {
    deepseekChatStream.mockResolvedValueOnce("```\nCierre de cremallera metalica\n```")
    const answer = await answerFieldFromImage({
      field: { label: "Tipo de cierre", why: "define hardware" },
      garmentType: "Hoodie",
      imageBase64: "AAA",
    })
    expect(deepseekChatStream).toHaveBeenCalledTimes(1)
    const call = deepseekChatStream.mock.calls[0][0]
    expect(call.messages[0].content).toHaveLength(2)
    expect(call.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } })
    expect(answer).toBe("Cierre de cremallera metalica")
  })

  it("streams partial text via onProgress when given, so the chat can show live feedback", async () => {
    const events = []
    deepseekChatStream.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({ contentSoFar: "Cierre de", tokensSoFar: 3 })
      onEvent({ contentSoFar: "Cierre de cremallera", tokensSoFar: 5 })
      return "Cierre de cremallera"
    })
    await answerFieldFromImage({
      field: { label: "Tipo de cierre" },
      garmentType: "Hoodie",
      imageBase64: "AAA",
      onProgress: (p) => events.push(p),
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ partialText: "Cierre de", tokensSoFar: 3 })
    expect(events[1].partialText).toContain("cremallera")
  })

  it("tells the vision model not to invent fabric specs from a mid-chat photo", async () => {
    deepseekChatStream.mockResolvedValueOnce("Tela tipo felpa aparente")
    await answerFieldFromImage({
      field: {
        label: "Tela principal",
        why: "Define tacto, peso, caida y costo base",
        options: ["Algodon felpado", "French terry"],
      },
      garmentType: "Hoodie",
      imageBase64: "AAA",
    })

    const prompt = deepseekChatStream.mock.calls[0][0].messages[0].content[0].text
    expect(prompt).toContain("Usa unicamente evidencia visible")
    expect(prompt).toContain("Nunca inventes peso/GSM, costo")
    expect(prompt).toContain("No se puede determinar con certeza desde la foto.")
    expect(prompt).toContain("Algodon felpado, French terry")
  })
})

describe("answerFieldFromImageSegments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("runs a full pass plus two capped quadrant passes and returns the strongest answer", async () => {
    let active = 0
    let maxActive = 0
    deepseekChatStream.mockImplementation(async ({ messages }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 3))
      active -= 1
      const image = messages[0].content[1].image_url.url
      if (image.includes("Q2")) return '{"answer":"Pana acanalada azul marino aparente","evidence":["canales verticales visibles"],"certainty":"high"}'
      return '{"answer":"No se puede determinar con certeza desde la foto.","evidence":[],"certainty":"low"}'
    })

    const answer = await answerFieldFromImageSegments({
      field: { label: "Tela principal", options: ["Pana", "Denim"] },
      garmentType: "Pantalon",
      segments: [
        { kind: "full", base64: "FULL" },
        { kind: "quadrant", quadrantLabel: "superior izquierdo", base64: "Q1" },
        { kind: "quadrant", quadrantLabel: "superior derecho", base64: "Q2" },
        { kind: "quadrant", quadrantLabel: "inferior izquierdo", base64: "Q3" },
        { kind: "quadrant", quadrantLabel: "inferior derecho", base64: "Q4" },
      ],
    })

    // full + first 2 quadrants (VISION_MAX_QUADRANTS) = 3 calls; the strong
    // answer sits in Q2, within the cap.
    expect(answer).toBe("Pana acanalada azul marino aparente")
    expect(deepseekChatStream).toHaveBeenCalledTimes(3)
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(deepseekChatStream.mock.calls.every(([options]) => options.provider === "nvidia")).toBe(true)
  })

  it("reports which segment is currently streaming", async () => {
    const events = []
    deepseekChatStream.mockImplementation(async ({ onEvent }) => {
      onEvent({ contentSoFar: "{", tokensSoFar: 1 })
      return '{"answer":"No se puede determinar con certeza desde la foto.","evidence":[],"certainty":"low"}'
    })
    await answerFieldFromImageSegments({
      field: { label: "Cierre" },
      garmentType: "Hoodie",
      segments: [
        { kind: "full", base64: "FULL" },
        { kind: "quadrant", quadrantLabel: "superior izquierdo", base64: "Q1" },
        { kind: "quadrant", quadrantLabel: "superior derecho", base64: "Q2" },
        { kind: "quadrant", quadrantLabel: "inferior izquierdo", base64: "Q3" },
        { kind: "quadrant", quadrantLabel: "inferior derecho", base64: "Q4" },
      ],
      onProgress: (event) => events.push(event),
    })
    // full + 2 capped quadrants = 3 processed segments
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ label: "Vista completa", segmentNumber: 1, totalSegments: 3 })
    expect(events.some((event) => event.label === "Detalle superior izquierdo")).toBe(true)
  })
})
