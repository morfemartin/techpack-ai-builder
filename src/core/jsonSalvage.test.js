import { describe, it, expect } from "vitest"
import { repairTruncatedJSON } from "./jsonSalvage.js"

describe("repairTruncatedJSON", () => {
  it("passes complete JSON through unchanged", () => {
    const result = repairTruncatedJSON('{"a":1,"b":2}')
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
  })

  it("drops a property cut off mid-value", () => {
    const result = repairTruncatedJSON('{"a":1,"b":2,"c')
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
  })

  it("keeps a nested object's own complete properties when its next one is cut", () => {
    const input = '{"fields":[{"key":"a","label":"A"},{"key":"b","lab'
    const result = repairTruncatedJSON(input)
    expect(JSON.parse(result)).toEqual({
      fields: [
        { key: "a", label: "A" },
        { key: "b" },
      ],
    })
  })

  it("returns null when the very first property never finished", () => {
    expect(repairTruncatedJSON('{"why":"porque es import')).toBe(null)
  })

  it("closes a nested array cut off mid-element", () => {
    const input = '{"fields":[{"key":"a","options":["X","Y'
    const result = repairTruncatedJSON(input)
    expect(JSON.parse(result)).toEqual({
      fields: [{ key: "a", options: ["X"] }],
    })
  })

  it("returns null for unrecoverable input", () => {
    expect(repairTruncatedJSON("not json at all")).toBe(null)
    expect(repairTruncatedJSON("")).toBe(null)
    expect(repairTruncatedJSON("{{{")).toBe(null)
  })

  it("recovers every fully-formed field when the last one is cut before any of its own properties complete", () => {
    const fields = Array.from({ length: 8 }, (_, i) => `{"key":"f${i}","label":"F${i}"}`).join(",")
    const input = `{"garmentType":"Camisa","fields":[${fields},{"key":"f8`
    const parsed = JSON.parse(repairTruncatedJSON(input))
    expect(parsed.fields).toHaveLength(8)
    expect(parsed.fields[7]).toEqual({ key: "f7", label: "F7" })
    expect(parsed.garmentType).toBe("Camisa")
  })

  it("returns null for non-string input", () => {
    expect(repairTruncatedJSON(null)).toBe(null)
    expect(repairTruncatedJSON(undefined)).toBe(null)
  })
})
