import { describe, expect, it } from "vitest"
import { UNITS, DEFAULT_UNIT, convertMeasure, formatDimensions, formatMeasure, normalizeUnit, parseMeasure } from "./units.js"

describe("parseMeasure", () => {
  it("accepts numbers and plain numeric strings", () => {
    expect(parseMeasure(80)).toBe(80)
    expect(parseMeasure("111.6")).toBe(111.6)
  })

  it("accepts a comma decimal separator", () => {
    // es-AR types 111,6 - reading that as null would silently drop a measurement
    expect(parseMeasure("111,6")).toBe(111.6)
  })

  it("returns null (never 0) for blank or non-numeric input", () => {
    // 0 would print a real-looking "0mm" on the tech pack; null prints nothing
    for (const v of ["", "   ", "abc", null, undefined, {}, NaN, Infinity]) {
      expect(parseMeasure(v)).toBe(null)
    }
  })
})

describe("convertMeasure", () => {
  it("converts through millimetres in both directions", () => {
    expect(convertMeasure(1, "in", "mm")).toBeCloseTo(25.4, 6)
    expect(convertMeasure(25.4, "mm", "in")).toBeCloseTo(1, 6)
    expect(convertMeasure(5, "cm", "mm")).toBeCloseTo(50, 6)
    expect(convertMeasure(50, "mm", "cm")).toBeCloseTo(5, 6)
    expect(convertMeasure(2.54, "cm", "in")).toBeCloseTo(1, 6)
  })

  it("round-trips without drift", () => {
    for (const u of UNITS) {
      expect(convertMeasure(convertMeasure(80, "mm", u), u, "mm")).toBeCloseTo(80, 6)
    }
  })

  it("is identity when both units match", () => {
    expect(convertMeasure(80, "mm", "mm")).toBe(80)
  })

  it("returns null for a missing measurement", () => {
    expect(convertMeasure("", "cm", "mm")).toBe(null)
  })
})

describe("normalizeUnit", () => {
  it("falls back rather than trusting an unknown unit", () => {
    expect(normalizeUnit("furlong")).toBe(DEFAULT_UNIT)
    expect(normalizeUnit(undefined)).toBe(DEFAULT_UNIT)
    expect(normalizeUnit("in")).toBe("in")
  })
})

describe("formatMeasure", () => {
  it("uses precision suited to the unit", () => {
    expect(formatMeasure(80, "mm")).toBe("80mm")
    expect(formatMeasure(8.25, "cm")).toBe("8.25cm")
    expect(formatMeasure(3.1496, "in")).toBe("3.15in")
  })

  it("trims trailing zeros instead of printing 80.0mm", () => {
    expect(formatMeasure(80.0, "mm")).toBe("80mm")
  })

  it("returns empty string for no measurement", () => {
    expect(formatMeasure("", "mm")).toBe("")
  })
})

describe("formatDimensions", () => {
  it("prints the pair in the requested output unit", () => {
    expect(formatDimensions(80, 45, "mm", "mm")).toBe("Ancho 80mm x Alto 45mm")
  })

  it("converts, and keeps the typed original visible for verification", () => {
    // "I type cm but want it printed in inches" - the person who measured it
    // must still be able to check their own number against the sheet.
    const out = formatDimensions(10, 5, "cm", "in")
    expect(out).toContain("Ancho 3.937in")
    expect(out).toContain("Alto 1.969in")
    expect(out).toContain("medido en 10cm x 5cm")
  })

  it("omits the parenthetical when no conversion happened", () => {
    expect(formatDimensions(80, 45, "mm", "mm")).not.toContain("medido en")
  })

  it("emits nothing when either side is missing", () => {
    // A half-filled design must never print "Ancho 80mm x Alto "
    expect(formatDimensions(80, "", "mm", "mm")).toBe("")
    expect(formatDimensions("", 45, "mm", "mm")).toBe("")
  })
})
