import { describe, it, expect } from "vitest"
import { normalizeSlotBriefs, briefLines } from "./briefs.js"

// Contract for structured illustrator briefs in Layout Engine v3.
//
// A brief must answer, for the human illustrator, in a separate technical
// rail so the art board remains editable:
//   - which garment part goes in this slot (garmentPart, view)
//   - what the drawing MUST mark/call out (mustMark[])
//   - which measurements to draw and how (measurements[{label, perSize}] -
//     rendered with the dimension-arrow convention note)
//   - what matters to the factory (factoryNote)
//
// The AI proposes `briefs[]` on an illustration region (one per slot); the
// normalizer guarantees the shape: pads missing slots with briefs derived
// deterministically from the page's design/refs data, coerces every field,
// and never returns fewer entries than slots.

const design = {
  name: "Chest Logo",
  pos: "Pecho izquierdo",
  posDetail: "80mm bajo costura de hombro",
  tec: "Bordado 3D",
  w: 70,
  h: 22,
  illustrationBrief: "Dibujar el frente con el logo.",
}
const ctx = { garmentType: "Hoodie", designs: [design] }
const page = { id: "p", title: "Chest Logo", purpose: "design:Chest Logo" }

describe("normalizeSlotBriefs", () => {
  it("keeps AI-provided briefs, coercing every field to its type", () => {
    const region = {
      type: "illustration",
      slots: 1,
      refs: ["Frente"],
      briefs: [
        {
          garmentPart: "Panel frontal",
          view: "Frente plano",
          mustMark: ["logo bordado", 42, null, "costura de hombro"],
          measurements: [{ label: "Ancho logo", perSize: false }, { label: 7 }],
          placementLandmark: "80mm bajo costura de hombro",
          factoryNote: "Bordado 3D foam",
        },
      ],
    }
    const briefs = normalizeSlotBriefs(region, page, ctx)
    expect(briefs).toHaveLength(1)
    expect(briefs[0].garmentPart).toBe("Panel frontal")
    expect(briefs[0].mustMark).toEqual(["logo bordado", "costura de hombro"])
    // The design's own real w/h (70x22mm) is never dropped just because the
    // model ALSO supplied its own measurement - both are real, distinct
    // facts and both must reach the illustrator.
    expect(briefs[0].measurements).toEqual([
      { id: "DIM-1", label: "Ancho 70mm x Alto 22mm", perSize: false, unit: "mm" },
      { id: "DIM-2", label: "Ancho logo", perSize: false, unit: "mm" },
    ])
    expect(briefs[0].callouts).toEqual([{ id: "V1.1", label: "logo bordado" }, { id: "V1.2", label: "costura de hombro" }])
    expect(briefs[0].slotCode).toBe("V1")
    expect(briefs[0].designCode).toBe("D1")
    expect(briefs[0].factoryNote).toBe("Bordado 3D foam")
  })

  it("does not duplicate the real dimension line when the model echoes the exact same label", () => {
    const region = {
      type: "illustration",
      slots: 1,
      refs: ["Frente"],
      briefs: [{ measurements: [{ label: "Ancho 70mm x Alto 22mm", perSize: false }] }],
    }
    const briefs = normalizeSlotBriefs(region, page, ctx)
    expect(briefs[0].measurements).toEqual([{ id: "DIM-1", label: "Ancho 70mm x Alto 22mm", perSize: false, unit: "mm" }])
  })

  it("pads missing slots with briefs derived from the design and refs", () => {
    const region = { type: "illustration", slots: 2, refs: ["Frente", "Detalle bordado"], briefs: [] }
    const briefs = normalizeSlotBriefs(region, page, ctx)
    expect(briefs).toHaveLength(2)
    // view falls back to the slot's ref; garmentPart to the design position
    expect(briefs[0].view).toBe("Frente")
    expect(briefs[1].view).toBe("Detalle bordado")
    expect(briefs[0].garmentPart).toBe("Pecho izquierdo")
    // technique reaches the factory note; dimensions reach measurements
    expect(briefs[0].factoryNote).toContain("Bordado 3D")
    expect(briefs[0].measurements.some((m) => /70/.test(m.label) || /ancho/i.test(m.label))).toBe(true)
  })

  it("returns exactly `slots` briefs even when the AI sent more", () => {
    const region = { type: "illustration", slots: 1, refs: ["Frente"], briefs: [{ view: "a" }, { view: "b" }, { view: "c" }] }
    expect(normalizeSlotBriefs(region, page, ctx)).toHaveLength(1)
  })

  it("survives garbage input without crashing", () => {
    const briefs = normalizeSlotBriefs({ type: "illustration", slots: 2, briefs: "nope" }, { id: "x", purpose: "overview" }, {})
    expect(briefs).toHaveLength(2)
    expect(typeof briefs[0].view).toBe("string")
    expect(Array.isArray(briefs[0].mustMark)).toBe(true)
  })
})

describe("briefLines (the illustrator-rail template)", () => {
  const full = {
    garmentPart: "Panel frontal",
    view: "Frente plano",
    mustMark: ["logo bordado", "costura de hombro"],
    measurements: [{ label: "Ancho logo 70mm", perSize: false }, { label: "Largo total", perSize: true }],
    placementLandmark: "80mm bajo costura de hombro",
    factoryNote: "Bordado 3D foam, direccion de puntada vertical",
  }

  it("renders the full template: title, placement, must-mark checklist, measurement legend, factory note", () => {
    const lines = briefLines(full, "full")
    const text = lines.join("\n")
    // The garment part is the one fact the block heading does not already
    // show, so it is the identifying line - the view name is not repeated
    // here (the badge and heading carry it).
    expect(text).toContain("Panel frontal")
    expect(text).not.toContain("FRENTE PLANO")
    expect(text).toMatch(/Señalar/i)
    expect(text).toContain("logo bordado")
    expect(text).toMatch(/cota|medida/i) // measurement convention line
    expect(text).toMatch(/por talla/i) // per-size flag surfaces
    expect(text).toMatch(/F[aá]brica/i)
  })

  it("degrades to checklist-only, then to title-only", () => {
    const checklist = briefLines(full, "checklist").join("\n")
    expect(checklist).toContain("Señalar")
    expect(checklist).not.toMatch(/F[aá]brica/i)

    const title = briefLines(full, "title")
    expect(title).toEqual(["Panel frontal"])
  })

  it("omits empty sections instead of rendering blank bullets", () => {
    const sparse = { garmentPart: "", view: "Espalda", mustMark: [], measurements: [], placementLandmark: "", factoryNote: "" }
    const text = briefLines(sparse, "full").join("\n")
    expect(text).toContain("ESPALDA")
    expect(text).not.toMatch(/Señalar/i)
    expect(text).not.toMatch(/F[aá]brica/i)
  })

  it("never prints 'Ubicación: <bare number>' - a measurement mislabeled as a place", () => {
    // reqsToDesigns() (techpackRequirements.js) keeps a numeric detail answer
    // out of posDetail for this exact reason, but placementLandmark can still
    // reach here from other callers - this is the render-side backstop.
    const numeric = { ...full, placementLandmark: "25" }
    expect(briefLines(numeric, "full").join("\n")).not.toMatch(/Ubicaci[oó]n/i)

    const decimal = { ...full, placementLandmark: "25,5" }
    expect(briefLines(decimal, "full").join("\n")).not.toMatch(/Ubicaci[oó]n/i)

    // Prose still prints normally, even when it starts with a number.
    const prose = { ...full, placementLandmark: "25mm bajo costura de hombro" }
    expect(briefLines(prose, "full").join("\n")).toMatch(/Ubicaci[oó]n: 25mm bajo costura de hombro/i)
  })
})
