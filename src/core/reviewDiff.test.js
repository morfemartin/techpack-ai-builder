import { describe, it, expect } from "vitest"
import { buildReviewFindings, findingsToWalkFields } from "./reviewDiff.js"

// Contract for the pre-download review diff used by Layout Engine v3.
//
// buildReviewFindings(intake, document) walks the user's intake truth
// against the generated document plan and reports, per datum, whether the
// document honors it:
//   { kind: "confirmed"|"missing"|"unplaced", topic, field, expected, foundOn }
// - confirmed: the datum has a home in the document (foundOn = page id)
// - missing:  a required datum is empty/absent in the intake itself
//             (the review chat should ASK for it)
// - unplaced: the datum exists in the intake but no page carries it
//             (the review chat should CONFIRM dropping or fix the plan)
//
// findingsToWalkFields(findings) converts findings into the same field shape
// the intake walker consumes ({key,label,category,status,options,why}) so a
// review chat can walk them with numbered options WITHOUT any AI call - the
// deterministic fallback when DeepSeek is unavailable.

const intake = {
  hdr: { brand: "Morfe", season: "2027 FW", sno: "", cat: "Prenda Superior", fab: "French terry", fac: "", ind: "", outd: "", pname: "Hoodie OS" },
  parts: [
    { id: "body", val: "French terry 480g", on: true },
    { id: "hood", val: "Doble capa", on: true },
    { id: "old", val: "Apagada", on: false },
  ],
  designs: [
    { name: "Chest Logo", pos: "Pecho", tec: "Bordado 3D", colors: [{ name: "Blue", hex: "#003DA5" }], emb: { machine: "Tajima" } },
    { name: "Ghost", pos: "Espalda", tec: "Print", colors: [] },
  ],
}

// A document plan: outline pages with purposes + per-page pieces, as
// produced by planDocumentOutline + planPageLayout (regions included).
const document = {
  pages: [
    { id: "cover", title: "Hoodie OS", purpose: "cover", regions: [{ type: "header" }, { type: "titleBar" }, { type: "illustration", slots: 1 }, { type: "disclaimer" }] },
    {
      id: "overview",
      title: "Estructura",
      purpose: "overview",
      regions: [{ type: "header" }, { type: "titleBar" }, { type: "split", regions: [{ type: "partsList" }, { type: "illustration", slots: 2 }] }, { type: "disclaimer" }],
    },
    {
      id: "design-chest-logo",
      title: "Chest Logo",
      purpose: "design:Chest Logo",
      regions: [{ type: "header" }, { type: "titleBar" }, { type: "illustration", slots: 1 }, { type: "colorSpecs" }, { type: "embSpecs" }, { type: "disclaimer" }],
    },
    // NOTE: no page for design "Ghost"
  ],
}

describe("buildReviewFindings", () => {
  const findings = buildReviewFindings(intake, document)

  it("confirms header fields that have values and flags empty required ones as missing", () => {
    const brand = findings.find((f) => f.topic === "header" && f.field === "brand")
    expect(brand.kind).toBe("confirmed")
    const sno = findings.find((f) => f.topic === "header" && f.field === "sno")
    expect(sno.kind).toBe("missing")
  })

  it("confirms every ACTIVE part against the page that carries the full BOM", () => {
    const body = findings.find((f) => f.topic === "part" && f.field === "body")
    expect(body.kind).toBe("confirmed")
    expect(body.foundOn).toBe("overview")
    // parts switched off are not reviewed
    expect(findings.find((f) => f.topic === "part" && f.field === "old")).toBeUndefined()
  })

  it("confirms a design with its own page and flags an uncovered design as unplaced", () => {
    const logo = findings.find((f) => f.topic === "design" && f.field === "Chest Logo")
    expect(logo.kind).toBe("confirmed")
    expect(logo.foundOn).toBe("design-chest-logo")
    const ghost = findings.find((f) => f.topic === "design" && f.field === "Ghost")
    expect(ghost.kind).toBe("unplaced")
    expect(ghost.foundOn).toBe(null)
  })

  it("flags a design's data blocks that its page does not carry", () => {
    // Chest Logo has colors AND emb; its page carries both -> no extra findings.
    // Remove embSpecs from the page and it must surface as unplaced.
    const doc2 = JSON.parse(JSON.stringify(document))
    doc2.pages[2].regions = doc2.pages[2].regions.filter((r) => r.type !== "embSpecs")
    const f2 = buildReviewFindings(intake, doc2)
    const emb = f2.find((f) => f.topic === "design-emb" && f.field === "Chest Logo")
    expect(emb.kind).toBe("unplaced")
  })

  it("does not treat an empty embroidery form as an unplaced worksheet", () => {
    const emptyEmbIntake = JSON.parse(JSON.stringify(intake))
    emptyEmbIntake.designs[1].emb = { machine: "", stitches: "", stopSeq: [] }
    const findings = buildReviewFindings(emptyEmbIntake, document)
    expect(findings.find((f) => f.topic === "design-emb" && f.field === "Ghost")).toBeUndefined()
  })

  it("never crashes on empty inputs", () => {
    expect(buildReviewFindings({}, {})).toEqual(expect.any(Array))
    expect(buildReviewFindings(null, null)).toEqual(expect.any(Array))
  })
})

describe("findingsToWalkFields (deterministic review walk, no AI needed)", () => {
  const findings = buildReviewFindings(intake, document)
  const fields = findingsToWalkFields(findings)

  it("emits ONLY problems as ask-fields; confirmed data becomes a summary, not questions", () => {
    // confirmed items must NOT generate a question each (a 20-part hoodie
    // would otherwise mean 20 pointless confirmations)
    const askKeys = fields.filter((f) => f.status === "ask").map((f) => f.key)
    expect(askKeys.some((k) => k.includes("body"))).toBe(false)
    // missing header field -> asked
    expect(askKeys.some((k) => k.includes("sno"))).toBe(true)
    // unplaced design -> asked
    expect(askKeys.some((k) => k.includes("Ghost"))).toBe(true)
  })

  it("gives every ask-field a label, 2-4 options, and a why", () => {
    for (const f of fields.filter((x) => x.status === "ask")) {
      expect(f.label).toBeTruthy()
      expect(f.options.length).toBeGreaterThanOrEqual(2)
      expect(f.options.length).toBeLessThanOrEqual(4)
      expect(f.why).toBeTruthy()
    }
  })

  it("unplaced-design questions offer keeping it (add page) or dropping it", () => {
    const ghost = fields.find((f) => f.status === "ask" && f.key.includes("Ghost"))
    const joined = ghost.options.join(" | ").toLowerCase()
    expect(joined).toMatch(/agregar|añadir|incluir/)
    expect(joined).toMatch(/quitar|descartar|omitir/)
  })
})
