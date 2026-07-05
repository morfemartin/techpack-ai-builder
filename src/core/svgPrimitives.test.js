import { describe, it, expect } from "vitest"
import { wrapLines } from "./svgPrimitives.js"

describe("wrapLines", () => {
  it("returns single-element array for short text fitting on one line", () => {
    const result = wrapLines("hello world", 200, 10)
    expect(result).toEqual(["hello world"])
  })

  it("wraps long text into multiple lines respecting character budget", () => {
    const maxWidth = 200
    const fontSize = 10
    const avgCharWidth = fontSize * 0.55
    const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth))
    const text = "the quick brown fox jumps over the lazy dog near the riverbank"
    const result = wrapLines(text, maxWidth, fontSize)
    expect(result.length).toBeGreaterThan(1)
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(maxCharsPerLine)
    }
  })

  it("returns empty array for empty string", () => {
    expect(wrapLines("", 200, 10)).toEqual([])
  })

  it("returns empty array for null input", () => {
    expect(wrapLines(null, 200, 10)).toEqual([])
  })

  it("returns empty array for undefined input", () => {
    expect(wrapLines(undefined, 200, 10)).toEqual([])
  })

  it("returns single-word line even if word exceeds per-line budget", () => {
    const maxWidth = 50
    const fontSize = 10
    const avgCharWidth = fontSize * 0.55
    const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth))
    const longWord = "supercalifragilisticexpialidocious"
    expect(longWord.length).toBeGreaterThan(maxCharsPerLine)
    const result = wrapLines(longWord, maxWidth, fontSize)
    expect(result).toEqual([longWord])
  })

  it("does not produce empty-string lines from multiple consecutive spaces", () => {
    const result = wrapLines("hello    world   again", 200, 10)
    expect(result).toEqual(["hello world again"])
    for (const line of result) {
      expect(line).not.toBe("")
    }
  })
})
