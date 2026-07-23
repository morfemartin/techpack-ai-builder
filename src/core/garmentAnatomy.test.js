import { describe, expect, it } from "vitest"
import { classifyGarmentFamily, incoherentPart, dropIncoherentFields } from "./garmentAnatomy.js"

describe("classifyGarmentFamily", () => {
  it("maps light knit tops to the tee family", () => {
    for (const name of ["franela", "Franela negra", "camiseta", "remera", "playera", "t-shirt", "musculosa", "tank top"]) {
      expect(classifyGarmentFamily(name)).toBe("tee")
    }
  })

  it("keeps hood-bearing garments out of the tee family even when other words appear", () => {
    expect(classifyGarmentFamily("sudadera con capucha")).toBe("hoodie")
    expect(classifyGarmentFamily("hoodie oversize")).toBe("hoodie")
    // an ambiguous string that literally says sudadera is trusted as a hoodie
    expect(classifyGarmentFamily("franela tipo sudadera")).toBe("hoodie")
  })

  it("recognizes other families and leaves the unknown untouched", () => {
    expect(classifyGarmentFamily("polo de golf")).toBe("polo")
    expect(classifyGarmentFamily("camisa oxford")).toBe("shirt")
    expect(classifyGarmentFamily("pantalon cargo")).toBe("bottom")
    expect(classifyGarmentFamily("campera impermeable")).toBe("jacket")
    expect(classifyGarmentFamily("")).toBe("unknown")
    expect(classifyGarmentFamily("artilugio textil raro")).toBe("unknown")
  })
})

describe("incoherentPart", () => {
  it("flags the parts a tee cannot have, by label or key", () => {
    expect(incoherentPart({ label: "Capucha", key: "hood" }, "tee")).toBe("capucha")
    expect(incoherentPart({ label: "Interior / forro", key: "lining" }, "tee")).toBe("forro")
    expect(incoherentPart({ label: "Cierre", key: "closure" }, "tee")).toBe("cierre")
    expect(incoherentPart({ label: "Cremallera frontal", key: "zipper" }, "tee")).toBe("cierre")
  })

  it("does not flag parts a tee legitimately has", () => {
    expect(incoherentPart({ label: "Cuello / escote", key: "neckline" }, "tee")).toBeNull()
    expect(incoherentPart({ label: "Manga", key: "sleeve" }, "tee")).toBeNull()
    expect(incoherentPart({ label: "Bolsillos", key: "pockets" }, "tee")).toBeNull()
    expect(incoherentPart({ label: "Tela principal", key: "fabric" }, "tee")).toBeNull()
  })

  it("never flags anything for an unrestricted family", () => {
    expect(incoherentPart({ label: "Capucha", key: "hood" }, "hoodie")).toBeNull()
    expect(incoherentPart({ label: "Cierre", key: "closure" }, "jacket")).toBeNull()
  })
})

describe("dropIncoherentFields", () => {
  it("removes hallucinated hood/lining/closure questions from a franela intake", () => {
    const reqs = {
      garmentType: "franela",
      fields: [
        { key: "fabric", label: "Tela", category: "general", status: "ask", value: "", options: ["A", "B"] },
        { key: "neckline", label: "Cuello", category: "general", status: "assumed", value: "Redondo rib", options: [] },
        { key: "closure", label: "Cierre", category: "general", status: "ask", value: "", options: ["Sin cierre", "Cordón"] },
        { key: "hood", label: "Capucha", category: "general", status: "assumed", value: "Forrada", options: [] },
        { key: "lining", label: "Forro interior", category: "general", status: "ask", value: "", options: ["Sí", "No"] },
        { key: "pockets", label: "Bolsillos", category: "general", status: "ask", value: "", options: ["Sin bolsillo", "Pecho"] },
      ],
    }
    const out = dropIncoherentFields(reqs)
    expect(out.fields.map((f) => f.key)).toEqual(["fabric", "neckline", "pockets"])
    expect(out.droppedParts).toEqual(expect.arrayContaining(["cierre", "capucha", "forro"]))
  })

  it("keeps a KNOWN value even if it names an impossible part, rather than hiding a conflict", () => {
    const reqs = {
      garmentType: "franela",
      fields: [
        { key: "hood", label: "Capucha", category: "general", status: "known", value: "observada en la foto", options: [] },
      ],
    }
    expect(dropIncoherentFields(reqs).fields).toHaveLength(1)
  })

  it("leaves a real hoodie's hood/closure questions in place", () => {
    const reqs = {
      garmentType: "hoodie",
      fields: [
        { key: "hood", label: "Capucha", category: "general", status: "ask", value: "", options: ["Doble tela", "Forrada"] },
        { key: "closure", label: "Cierre", category: "general", status: "ask", value: "", options: ["Pullover", "Zipper"] },
      ],
    }
    expect(dropIncoherentFields(reqs).fields).toHaveLength(2)
    expect(dropIncoherentFields(reqs).droppedParts).toEqual([])
  })

  it("never trims an unknown garment", () => {
    const reqs = {
      garmentType: "artilugio raro",
      fields: [{ key: "closure", label: "Cierre", category: "general", status: "ask", value: "", options: ["a", "b"] }],
    }
    expect(dropIncoherentFields(reqs).fields).toHaveLength(1)
  })
})
