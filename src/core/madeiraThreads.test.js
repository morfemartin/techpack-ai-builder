import { describe, expect, it } from "vitest"
import { findMadeiraThreadByCode, findMadeiraThreadByName, searchMadeiraThreads, canonicalizeStopSeq } from "./madeiraThreads.js"

describe("findMadeiraThreadByCode", () => {
  it("finds a thread by its bare 4-digit code", () => {
    expect(findMadeiraThreadByCode("1055")).toEqual({ code: "1055", name: "Latte" })
  })

  it("pulls the code out of noisy text like a source document would have", () => {
    expect(findMadeiraThreadByCode("Madeira Classic 1352")).toEqual({ code: "1352", name: "Old Gold" })
  })

  it("returns null for an unrecognized or missing code", () => {
    expect(findMadeiraThreadByCode("9999")).toBeNull()
    expect(findMadeiraThreadByCode("")).toBeNull()
    expect(findMadeiraThreadByCode(undefined)).toBeNull()
  })
})

describe("findMadeiraThreadByName", () => {
  it("matches case-insensitively on the exact official name", () => {
    expect(findMadeiraThreadByName("old gold")).toEqual({ code: "1352", name: "Old Gold" })
  })

  it("does not fuzzy-match a partial or wrong name", () => {
    expect(findMadeiraThreadByName("Gold")).toBeNull()
    expect(findMadeiraThreadByName("Old Golde")).toBeNull()
  })
})

describe("searchMadeiraThreads", () => {
  it("ranks code/name prefix matches before substring matches", () => {
    const results = searchMadeiraThreads("gold")
    expect(results[0].name).toBe("Gold Rush") // starts-with "Gold"
    expect(results.some((t) => t.name === "Old Gold")).toBe(true) // contains "gold"
  })

  it("returns an empty list for an empty query", () => {
    expect(searchMadeiraThreads("")).toEqual([])
  })
})

describe("canonicalizeStopSeq", () => {
  // Real production doc claimed "Madeira Classic 1055" was "Old Gold" -
  // Madeira's own official chart says 1055 is "Latte". The code is what
  // Madeira calls authoritative, so it wins over whatever name came with it.
  it("corrects a name that disagrees with the official chart for its code", () => {
    const { stopSeq, corrections } = canonicalizeStopSeq([
      { stop: 1, color: "", stitches: "4200", code: "1055", name: "Old Gold" },
    ])
    expect(stopSeq).toEqual([{ stop: 1, color: "", stitches: "4200", code: "1055", name: "Latte" }])
    expect(corrections).toEqual([
      { stop: 1, extractedCode: "1055", extractedName: "Old Gold", officialCode: "1055", officialName: "Latte" },
    ])
  })

  it("backfills a missing code from an exact name match", () => {
    const { stopSeq, corrections } = canonicalizeStopSeq([{ stop: 1, color: "", stitches: "900", code: "", name: "Onyx" }])
    expect(stopSeq).toEqual([{ stop: 1, color: "", stitches: "900", code: "1199", name: "Onyx" }])
    expect(corrections).toHaveLength(1)
  })

  it("leaves an already-correct stop untouched and reports no correction", () => {
    const { stopSeq, corrections } = canonicalizeStopSeq([{ stop: 1, color: "", stitches: "900", code: "1199", name: "Onyx" }])
    expect(stopSeq).toEqual([{ stop: 1, color: "", stitches: "900", code: "1199", name: "Onyx" }])
    expect(corrections).toEqual([])
  })

  it("leaves a stop with no recognizable code or name untouched", () => {
    const input = [{ stop: 1, color: "", stitches: "900", code: "9999", name: "Not A Real Thread" }]
    const { stopSeq, corrections } = canonicalizeStopSeq(input)
    expect(stopSeq).toEqual(input)
    expect(corrections).toEqual([])
  })

  it("tolerates a missing or empty stopSeq", () => {
    expect(canonicalizeStopSeq(undefined)).toEqual({ stopSeq: [], corrections: [] })
    expect(canonicalizeStopSeq([])).toEqual({ stopSeq: [], corrections: [] })
  })
})
