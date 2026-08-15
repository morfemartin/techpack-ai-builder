import { describe, expect, it } from "vitest"
import { buildLocalizedSnapshot } from "./localizedSnapshot.js"

describe("buildLocalizedSnapshot", () => {
  it("localizes the canonical data before planning while preserving production invariants", () => {
    const source = {
      hdr: { brand: "Arrive Aruba", pname: "Polo manga corta" },
      parts: [{ id: 7, on: true, customName: "Cuello", val: "Rib 1x1, 70mm" }, { id: 8, on: false, val: "Oculta" }],
      designs: [{ name: "Logo pecho", pos: "Pecho izquierdo", posDetail: "80mm bajo hombro", tec: "Bordado", illustrationBrief: "Dibujar frente", colors: [{ name: "Azul", hex: "#112233" }], fileName: "logo.svg" }],
      fabricColors: [{ name: "Verde", hex: "#92AF88", pantoneApprox: "15-6316 TCX" }],
      sizeChart: { sizes: ["M"], poms: [{ id: "A", label: "Medio pecho", howToMeasure: "2cm bajo sisa", values: { M: 54 }, unit: "cm" }], constants: [] },
    }
    const tx = {
      pname: "Short-sleeve polo",
      parts: ["1x1 rib, 70mm"],
      partLabels: ["Collar"],
      designs: [{ name: "Chest logo", pos: "Left chest", posDetail: "80mm below shoulder", technique: "Embroidery", illustrationBrief: "Draw front", colors: [{ name: "Blue" }] }],
      fabricColors: [{ name: "Green" }],
      sizeChart: { poms: [{ label: "Half chest", howToMeasure: "2cm below armhole" }], constants: [] },
    }

    const localized = buildLocalizedSnapshot(source, tx)

    expect(localized.hdr).toEqual({ brand: "Arrive Aruba", pname: "Short-sleeve polo" })
    expect(localized.parts[0]).toMatchObject({ id: 7, customName: "Collar", val: "1x1 rib, 70mm" })
    expect(localized.parts[1]).toEqual(source.parts[1])
    expect(localized.designs[0]).toMatchObject({ name: "Chest logo", tec: "Embroidery", fileName: "logo.svg" })
    expect(localized.designs[0].colors[0]).toEqual({ name: "Blue", hex: "#112233" })
    expect(localized.fabricColors[0]).toMatchObject({ name: "Green", hex: "#92AF88", pantoneApprox: "15-6316 TCX" })
    expect(localized.sizeChart.poms[0]).toMatchObject({ label: "Half chest", values: { M: 54 }, unit: "cm" })
    expect(localized.partLabels).toEqual({ 7: "Collar", 8: "" })
  })
})
