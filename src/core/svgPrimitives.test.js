import { describe, it, expect } from "vitest"
import { wrapLines, fitText } from "./svgPrimitives.js"

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

describe("fitText", () => {
  it("uses maxSize when short text already fits comfortably", () => {
    const fit = fitText("Short brief.", 300, 200, { maxSize: 11, minSize: 7 })
    expect(fit.size).toBe(11)
    expect(fit.lines).toEqual(["Short brief."])
  })

  it("shrinks the font size until a longer text fits the given height", () => {
    const long = "Dibujar el hoodie en plano tecnico frente y espalda a la misma escala, acotando largo total desde hombro y ancho de bolsillo canguro."
    const fit = fitText(long, 220, 40, { maxSize: 11, minSize: 7 })
    expect(fit.size).toBeLessThan(11)
    expect(fit.size).toBeGreaterThanOrEqual(7)
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(40)
  })

  it("never returns a size below minSize, even for very long text in a tiny box", () => {
    const veryLong = "x ".repeat(400)
    const fit = fitText(veryLong, 100, 20, { maxSize: 11, minSize: 7 })
    expect(fit.size).toBe(7)
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(20 + 1) // floor rounding tolerance
  })

  it("returns no lines for empty text without throwing", () => {
    expect(fitText("", 200, 100)).toEqual({ size: 11, lineHeight: Math.round(11 * 1.35), lines: [] })
  })
})
