import { describe, expect, it } from "vitest"
import { buildDeterministicCustomDocument } from "./deterministicDocument.js"

function part(id, value) {
  return { id, val: value, on: true, customName: "Spec " + id }
}

function context(parts) {
  const designs = [{ id: "d1", name: "Chest logo", pos: "Left chest", tec: "Embroidery", colors: [{ name: "Black", hex: "#111111" }] }]
  const hdr = { brand: "Morfe", pname: "Test garment", sno: "T-01" }
  const baseContext = { garmentType: "Test garment", parts, designs, fabricColors: [], lang: "ES" }
  const renderContext = { ...baseContext, hdr, txData: null, designerTx: null, logo: null }
  return { baseContext, renderContext, designs }
}

describe("deterministic semantic document fallback", () => {
  it("keeps a short technical list in a bottom band instead of the classic floating table", () => {
    const input = context([part("shell", "Cotton pique 220 g/m2")])
    const pages = buildDeterministicCustomDocument(input)
    const technical = pages.find((page) => page.compositionDecision && page.compositionDecision.mode === "hero-bottom-band")
    expect(technical).toBeTruthy()
    expect(technical.svg).toContain("viewBox='0 0 1188 840'")
  })

  it("keeps a dense BOM beside artwork and never falls back to the fixed legacy generator", () => {
    const input = context(Array.from({ length: 16 }, (_, index) => part("p" + index, "Technical specification with enough detail to wrap")))
    const pages = buildDeterministicCustomDocument(input)
    const bom = pages.find((page) => page.compositionDecision && page.compositionDecision.mode === "bom-hero")
    expect(bom).toBeTruthy()
    expect(bom.compositionDecision.widths).toEqual([272, 840])
  })
})
