import { describe, it, expect } from "vitest"
import { normalizeSlotBriefs, briefLines } from "./briefs.js"

// Contract for structured illustrator briefs (Phase 3 of Layout Engine v2).
//
// A brief must answer, for the human illustrator, WITHOUT taking layout
// space (it renders inside the art board):
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
    expect(briefs[0].measurements).toEqual([{ label: "Ancho logo", perSize: false }])
    expect(briefs[0].factoryNote).toBe("Bordado 3D foam")
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

describe("briefLines (the in-board template)", () => {
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
    expect(text).toContain("FRENTE PLANO")
    expect(text).toContain("Panel frontal")
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
    expect(title.length).toBeLessThanOrEqual(2)
    expect(title.join(" ")).toContain("FRENTE PLANO")
  })

  it("omits empty sections instead of rendering blank bullets", () => {
    const sparse = { garmentPart: "", view: "Espalda", mustMark: [], measurements: [], placementLandmark: "", factoryNote: "" }
    const text = briefLines(sparse, "full").join("\n")
    expect(text).toContain("ESPALDA")
    expect(text).not.toMatch(/Señalar/i)
    expect(text).not.toMatch(/F[aá]brica/i)
  })
})
