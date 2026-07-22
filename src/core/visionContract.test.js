import { describe, expect, it } from "vitest"
import {
  buildGarmentVisionPrompt,
  mergeFocusedVisionAnswers,
  mergeVisionAnalyses,
  normalizeVisionAnalysis,
  parseVisionJSON,
  visionAnalysisToSeed,
} from "./visionContract.js"

describe("garment vision contract", () => {
  it("parses fenced JSON and rejects prose-only output", () => {
    expect(parseVisionJSON('```json\n{"garmentType":"Hoodie","observations":[]}\n```').garmentType).toBe("Hoodie")
    expect(parseVisionJSON("parece un hoodie")).toBeNull()
  })

  it("salvages an explicit labelled checklist from a weak model", () => {
    const parsed = parseVisionJSON([
      "The visible result is:",
      "* Garment Type: Swim Trunks",
      "* View: Front",
      "* Base Color: White",
      "* Pockets: Unknown",
      "* Artwork: Floral pattern",
    ].join("\n"))
    expect(parsed).toMatchObject({
      garmentType: "Swim Trunks",
      view: "Front",
      baseColor: "White",
      pockets: [],
      artwork: ["Floral pattern"],
    })
  })

  it("salvages explicit garment facts from non-JSON vision prose", () => {
    const parsed = parseVisionJSON("The brown fuzzy hoodie has a relaxed oversized fit. A large embroidered lettering logo is centered on the back. The hem is ribbed.")
    expect(parsed).toMatchObject({ garmentType: "hoodie", view: "back", fit: "relaxed" })
    expect(parsed.artwork.join(" ")).toContain("embroidered lettering logo")
    expect(parsed.hem).toContain("hem is ribbed")
  })

  it("keeps full-image identity while quadrants add independent evidence", () => {
    const full = normalizeVisionAnalysis({
      garmentType: "Hoodie",
      view: "front",
      observations: [{ category: "color", value: "Negro lavado", certainty: "high" }],
      unknown: ["composicion"],
    }, { kind: "full" })
    const detail = normalizeVisionAnalysis({
      garmentType: "",
      view: "detail",
      observations: [{ category: "pocket", value: "Bolsillo canguro con doble pespunte", certainty: "high" }],
      unknown: ["GSM"],
    }, { kind: "quadrant", quadrantLabel: "inferior izquierdo" })

    const merged = mergeVisionAnalyses([full, detail])
    expect(merged.garmentType).toBe("Hoodie")
    expect(merged.view).toBe("front")
    expect(merged.observations.map((item) => item.category)).toEqual(["color", "pocket"])
    expect(merged.observations[1].sourceLabel).toBe("inferior izquierdo")
    expect(merged.unknown).toEqual(["composicion", "GSM"])
  })

  it("converts typed observations to stable intake keys", () => {
    const seed = visionAnalysisToSeed({
      view: "back",
      observations: [
        { category: "artwork", value: "Lettering bordado negro" },
        { category: "material_appearance", value: "Pelo sintetico aparente" },
      ],
    })
    expect(seed).toEqual({
      "Vista observada": "back",
      "Diseno o aplicacion visible": "Lettering bordado negro",
      "Tela aparente": "Pelo sintetico aparente",
    })
  })

  it("forbids unsupported factory specifications in both full and quadrant prompts", () => {
    const full = buildGarmentVisionPrompt({ kind: "full" })
    const construction = buildGarmentVisionPrompt({ kind: "full", pass: "construction", garmentType: "hoodie" })
    const quadrant = buildGarmentVisionPrompt({ kind: "quadrant", quadrantLabel: "superior derecho" })
    for (const prompt of [full, quadrant]) {
      expect(prompt).toMatch(/Never infer fiber.*GSM.*measurements/)
      expect(prompt).toContain("unknown")
    }
    expect(full).toContain('"baseColor"')
    expect(construction).toContain('"frontClosure"')
    expect(quadrant).toContain('"observations"')
    expect(quadrant).toContain("superior derecho quadrant")
  })

  it("normalizes the constrained full-image checklist into stable semantic slots", () => {
    const analysis = normalizeVisionAnalysis({
      garmentType: "hoodie",
      view: "front",
      baseColor: "washed black",
      fit: "oversized",
      shoulder: "drop shoulder",
      hood: "double/lined apparent",
      frontClosure: "pullover/no front opening",
      closureEvidence: "continuous front with no front opening",
      pockets: [{ type: "kangaroo", location: "lower front" }],
      cuffs: "ribbed",
      hem: "ribbed",
      waistband: "unknown",
    }, { kind: "full" })

    expect(analysis.observations.map((item) => item.attribute)).toEqual([
      "color.base",
      "silhouette.fit",
      "construction.shoulder",
      "construction.hood",
      "closure.front",
      "finish.cuffs",
      "finish.hem",
      "pocket.lower front.kangaroo",
    ])
  })

  it("does not let a quadrant overwrite a full-image semantic slot", () => {
    const full = normalizeVisionAnalysis({ baseColor: "black", fit: "oversized" }, { kind: "full" })
    const detail = normalizeVisionAnalysis({
      observations: [
        { category: "color", attribute: "color.base", value: "navy", certainty: "high" },
        { category: "finish", attribute: "finish.cuff", value: "ribbed cuff", certainty: "high" },
      ],
    }, { kind: "quadrant", quadrantLabel: "superior derecho" })

    const merged = mergeVisionAnalyses([full, detail])
    expect(merged.observations.find((item) => item.attribute === "color.base").value).toBe("black")
    expect(merged.observations.find((item) => item.attribute === "finish.cuff").value).toBe("ribbed cuff")
  })
})

describe("focused vision reducer", () => {
  it("prefers a high-certainty detailed observation over a vague full-image answer", () => {
    expect(mergeFocusedVisionAnswers([
      { answer: "Tejido oscuro aparente", certainty: "low", sourceKind: "full" },
      { answer: "Pana acanalada azul marino aparente", certainty: "high", sourceKind: "quadrant" },
    ])).toBe("Pana acanalada azul marino aparente")
  })

  it("returns an explicit unknown when no segment provides evidence", () => {
    expect(mergeFocusedVisionAnswers([
      { answer: "No se puede determinar con certeza desde la foto.", certainty: "low", sourceKind: "full" },
      { answer: "", certainty: "low", sourceKind: "quadrant" },
    ])).toBe("No se puede determinar con certeza desde la foto.")
  })
})
