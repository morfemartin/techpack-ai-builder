import { describe, expect, it } from "vitest"
import { scoreVisionResult, summarizeVisionBenchmark } from "./visionBenchmark.js"

const fixture = {
  minimumAffinity: 0.8,
  expectedClaims: [
    { id: "type", weight: 3, terms: ["hoodie", "sudadera con capucha"] },
    { id: "pocket", weight: 2, terms: ["bolsillo canguro"] },
    { id: "finish", weight: 1, terms: ["rib", "acanalado"] },
  ],
  forbiddenClaims: ["100% algodon", "350 gsm"],
}

describe("vision benchmark scorer", () => {
  it("scores weighted semantic claims instead of exact JSON keys", () => {
    const score = scoreVisionResult({ analysis: {
      garmentType: "Sudadera con capucha",
      observations: [
        { category: "pocket", value: "Bolsillo canguro frontal" },
        { category: "finish", value: "Punos de rib" },
      ],
    } }, fixture)
    expect(score.affinity).toBe(1)
    expect(score.passed).toBe(true)
  })

  it("penalizes unsupported specifications even when visible coverage is complete", () => {
    const score = scoreVisionResult({ analysis: {
      garmentType: "Hoodie",
      observations: [
        { category: "pocket", value: "Bolsillo canguro" },
        { category: "finish", value: "Rib; 100% algodon; 350 GSM" },
      ],
    } }, fixture)
    expect(score.coverage).toBe(1)
    expect(score.hallucinationPenalty).toBe(0.2)
    expect(score.passed).toBe(false)
  })

  it("summarizes the dataset gate", () => {
    expect(summarizeVisionBenchmark([
      { score: { affinity: 0.9, passed: true } },
      { score: { affinity: 0.7, passed: false } },
    ], 0.8)).toMatchObject({ averageAffinity: 0.8, passed: 1, failed: 1, total: 2, allPassed: false })
  })

  it("does not let a word in the wrong field satisfy a scoped claim", () => {
    const score = scoreVisionResult({ analysis: {
      garmentType: "Shorts",
      view: "front",
      observations: [{ category: "pocket", value: "back welt pocket" }],
    } }, {
      minimumAffinity: 0.8,
      expectedClaims: [{ id: "view", weight: 1, terms: ["back"] }],
      forbiddenClaims: [],
    })
    expect(score.affinity).toBe(0)
  })
})
