import { describe, expect, it } from "vitest"
import { normalizeLanguageConfig, sortedTextileLanguages, toggleFactoryLanguage } from "./languageConfig.js"

describe("language configuration", () => {
  it("offers the ten textile languages alphabetically for the UI locale", () => {
    const spanish = sortedTextileLanguages("ES")
    expect(spanish).toHaveLength(10)
    expect(spanish.map((item) => item.code)).toEqual(["DE", "BN", "ZH", "ES", "FR", "EN", "IT", "PT", "TR", "VI"])
  })

  it("normalizes independent source, factory and designer languages", () => {
    expect(normalizeLanguageConfig({
      sourceLanguage: "EN",
      factoryLanguages: ["DE", "VI", "DE"],
      designerLanguage: "ES",
      outputMode: "multilingual",
    })).toEqual({ sourceLanguage: "EN", factoryLanguages: ["DE", "VI"], designerLanguage: "ES", outputMode: "multilingual" })
  })

  it("never allows removing the last factory language", () => {
    expect(toggleFactoryLanguage(["ES"], "ES")).toEqual(["ES"])
    expect(toggleFactoryLanguage(["ES", "EN"], "ES")).toEqual(["EN"])
  })
})
