import { describe, expect, it } from "vitest"
import { classifyGarmentFamily, incoherentPart, dropIncoherentFields, mootFieldsFromAnswer } from "./garmentAnatomy.js"

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

describe("mootFieldsFromAnswer", () => {
  const buttonFields = [
    { key: "has_buttons", label: "¿Lleva botones?", category: "general", status: "ask" },
    { key: "button_count", label: "Cantidad de botones", category: "general", status: "ask" },
    { key: "button_material", label: "Material de los botones", category: "general", status: "ask" },
    { key: "buttonholes", label: "Ojales", category: "general", status: "ask" },
    { key: "fabric", label: "Tela principal", category: "general", status: "ask" },
  ]

  it("silences the rest of the same topic when the answer says 'none' - the literal 'no lleva botones' complaint", () => {
    const answered = buttonFields[0]
    const moot = mootFieldsFromAnswer(buttonFields, answered, "No lleva botones")
    expect(moot.sort()).toEqual(["button_count", "button_material", "buttonholes"])
    // an unrelated field is never touched
    expect(moot).not.toContain("fabric")
    // the answered field itself is never in its own moot list
    expect(moot).not.toContain("has_buttons")
  })

  it("recognizes several phrasings of 'none'", () => {
    for (const value of ["Sin cierre", "Ninguno", "No tiene", "no aplica", "None"]) {
      expect(mootFieldsFromAnswer(buttonFields, buttonFields[0], value).length).toBeGreaterThan(0)
    }
  })

  it("does nothing when the answer is a real choice, not a 'none'", () => {
    expect(mootFieldsFromAnswer(buttonFields, buttonFields[0], "Si, 4 botones")).toEqual([])
  })

  it("only moots fields still pending 'ask' - never re-opens known/assumed/design fields", () => {
    const mixed = [
      { key: "has_buttons", label: "¿Lleva botones?", category: "general", status: "ask" },
      { key: "button_count", label: "Cantidad de botones", category: "general", status: "known", value: "4" },
      { key: "button_material", label: "Material de los botones", category: "general", status: "assumed", value: "plastico" },
      { key: "button_logo", label: "Botón con logo", category: "design", status: "ask" },
    ]
    expect(mootFieldsFromAnswer(mixed, mixed[0], "No lleva botones")).toEqual([])
  })

  it("does nothing for a field outside any recognized topic", () => {
    const fields = [{ key: "fabric", label: "Tela principal", category: "general", status: "ask" }]
    expect(mootFieldsFromAnswer(fields, fields[0], "No aplica")).toEqual([])
  })
})
