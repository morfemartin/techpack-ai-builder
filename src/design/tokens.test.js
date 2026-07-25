import { afterEach, describe, expect, it } from "vitest"
import { PALETTES, getActivePaletteName, getPaletteNames, palette, role, setPalette } from "./tokens.js"

// The default preset must reproduce EXACTLY today's hardcoded values - any
// document generated before presets existed must render identically unless
// someone deliberately switches away from "bauhaus".
const ORIGINAL_BAUHAUS = {
  white: "#FFFFFF",
  yellow: "#F5C518",
  red: "#E11D3A",
  blue: "#1A3FB0",
  ink: "#141518",
}

describe("tokens palette presets", () => {
  afterEach(() => {
    setPalette("bauhaus")
  })

  it("defaults to bauhaus and matches the original hardcoded hex values byte-for-byte", () => {
    expect(getActivePaletteName()).toBe("bauhaus")
    expect(palette.white.hex).toBe(ORIGINAL_BAUHAUS.white)
    expect(palette.yellow.hex).toBe(ORIGINAL_BAUHAUS.yellow)
    expect(palette.red.hex).toBe(ORIGINAL_BAUHAUS.red)
    expect(palette.blue.hex).toBe(ORIGINAL_BAUHAUS.blue)
    expect(palette.ink.hex).toBe(ORIGINAL_BAUHAUS.ink)
  })

  it("derives role fills from the default palette exactly as before presets existed", () => {
    expect(role.index.fill).toBe(ORIGINAL_BAUHAUS.red)
    expect(role.priority.fill).toBe(ORIGINAL_BAUHAUS.blue)
    expect(role.highlight.fill).toBe(ORIGINAL_BAUHAUS.yellow)
    expect(role.structure.fill).toBe(ORIGINAL_BAUHAUS.ink)
    expect(role.surface.fill).toBe(ORIGINAL_BAUHAUS.white)
  })

  it("lists at least the three shipped presets, bauhaus first", () => {
    const names = getPaletteNames()
    expect(names[0]).toBe("bauhaus")
    expect(names).toContain("mono")
    expect(names).toContain("signal")
  })

  it("setPalette mutates the same exported palette object rather than replacing it", () => {
    const paletteRef = palette
    const roleRef = role
    setPalette("mono")
    expect(palette).toBe(paletteRef)
    expect(role).toBe(roleRef)
    expect(palette.blue.hex).toBe(PALETTES.mono.blue.hex)
  })

  it("re-derives every role after a switch, and reverts cleanly back to bauhaus", () => {
    setPalette("signal")
    expect(role.index.fill).toBe(PALETTES.signal.red.hex)
    expect(role.priority.fill).toBe(PALETTES.signal.blue.hex)
    expect(role.highlight.fill).toBe(PALETTES.signal.yellow.hex)

    setPalette("bauhaus")
    expect(getActivePaletteName()).toBe("bauhaus")
    expect(role.index.fill).toBe(ORIGINAL_BAUHAUS.red)
    expect(role.priority.fill).toBe(ORIGINAL_BAUHAUS.blue)
  })

  it("falls back to bauhaus for an unknown preset name instead of throwing", () => {
    const result = setPalette("does-not-exist")
    expect(result).toBe("bauhaus")
    expect(getActivePaletteName()).toBe("bauhaus")
  })

  it("keeps white/ink shared as pure white / near-black across every preset (B/W legibility floor)", () => {
    for (const name of getPaletteNames()) {
      expect(PALETTES[name].white.hex).toBe("#FFFFFF")
      expect(PALETTES[name].ink.hex).toBe("#141518")
    }
  })
})
