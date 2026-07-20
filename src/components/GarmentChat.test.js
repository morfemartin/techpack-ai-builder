import { describe, expect, it } from "vitest"
import { looksLikeQuestion } from "../core/techpackRequirements.js"

describe("conversational clarification intent", () => {
  it("keeps the current question active when the user asks a natural-language doubt without punctuation", () => {
    expect(looksLikeQuestion("que es eso")).toBe(true)
    expect(looksLikeQuestion("no entiendo esta opcion")).toBe(true)
    expect(looksLikeQuestion("explicame con un ejemplo")).toBe(true)
  })

  it("does not mistake a normal option value for a question", () => {
    expect(looksLikeQuestion("Algodon pique")).toBe(false)
  })
})
