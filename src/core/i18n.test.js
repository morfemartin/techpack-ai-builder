import { describe, expect, it } from "vitest"
import {
  T, UI,
  uiPhotosCount, uiSearchReferences, uiDevelopingPage, uiResolvingBlock,
  uiApplyingRevision, uiPagesUsedFallback, uiPageDesignFailed,
} from "./i18n.js"

// UI is the app's OWN chrome (App.jsx's uiLang toggle) - distinct from T,
// the exported document's language. A key present in one locale but missing
// in another would silently fall back to undefined in the JSX, rendering
// nothing - this is the guardrail against a string added to ES and never
// translated (or vice versa).
describe("UI locale key parity", () => {
  it("ES and EN define exactly the same set of keys", () => {
    const es = Object.keys(UI.ES).sort()
    const en = Object.keys(UI.EN).sort()
    expect(en).toEqual(es)
  })

  it("no UI string is empty in either locale", () => {
    for (const lang of ["ES", "EN"]) {
      for (const [key, value] of Object.entries(UI[lang])) {
        expect(String(value || "").trim(), `UI.${lang}.${key} should not be empty`).not.toBe("")
      }
    }
  })
})

// T (export-content strings) predates this phase but shares the same
// silent-fallback risk - worth the same guardrail while touching this file.
describe("T (export content) locale key parity", () => {
  it("ES, EN and ZH define exactly the same set of keys", () => {
    const es = Object.keys(T.ES).sort()
    expect(Object.keys(T.EN).sort()).toEqual(es)
    expect(Object.keys(T.ZH).sort()).toEqual(es)
  })

  it("array-valued fields (steps/cats/tecs/vw) have the same length across locales", () => {
    for (const key of ["steps", "cats", "tecs", "vw"]) {
      expect(T.EN[key]).toHaveLength(T.ES[key].length)
      expect(T.ZH[key]).toHaveLength(T.ES[key].length)
    }
  })
})

describe("interpolated UI helpers", () => {
  it("uiPhotosCount", () => {
    expect(uiPhotosCount("ES", 3)).toBe("3 foto(s)")
    expect(uiPhotosCount("EN", 3)).toBe("3 photo(s)")
  })

  it("uiSearchReferences", () => {
    expect(uiSearchReferences("ES", "Manga")).toContain("Manga")
    expect(uiSearchReferences("EN", "Sleeve")).toMatch(/^Search image references/)
  })

  it("uiDevelopingPage", () => {
    expect(uiDevelopingPage("ES", 2, 5)).toBe("Desarrollando pagina 2 de 5")
    expect(uiDevelopingPage("EN", 2, 5)).toBe("Developing page 2 of 5")
  })

  it("uiResolvingBlock", () => {
    expect(uiResolvingBlock("ES", "titleBar")).toBe("Resolviendo bloque: titleBar")
    expect(uiResolvingBlock("EN", "titleBar")).toBe("Resolving block: titleBar")
  })

  it("uiApplyingRevision", () => {
    expect(uiApplyingRevision("ES", 1, 3)).toBe("Aplicando revision: pagina 1 de 3...")
    expect(uiApplyingRevision("EN", 1, 3)).toBe("Applying revision: page 1 of 3...")
  })

  it("uiPagesUsedFallback pluralizes correctly in both locales", () => {
    expect(uiPagesUsedFallback("ES", 1)).toBe("1 página usó layout estándar (falló la IA)")
    expect(uiPagesUsedFallback("ES", 3)).toBe("3 páginas usaron layout estándar (falló la IA)")
    expect(uiPagesUsedFallback("EN", 1)).toBe("1 page used the standard layout (AI failed)")
    expect(uiPagesUsedFallback("EN", 3)).toBe("3 pages used the standard layout (AI failed)")
  })

  it("uiPageDesignFailed", () => {
    expect(uiPageDesignFailed("ES", 2, "Portada")).toContain("Página 2 (Portada)")
    expect(uiPageDesignFailed("EN", 2, "Cover")).toContain("Page 2 (Cover)")
  })
})
