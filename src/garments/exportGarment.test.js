import { describe, it, expect } from "vitest"
import { generateGarmentFileText } from "./exportGarment.js"
import { buildCustomGarment } from "./buildCustomGarment.js"

describe("generateGarmentFileText", () => {
  const garment = buildCustomGarment({
    id: "polo",
    label: "Polo Clasico",
    parts: [{ label: "Botones", val: "3, nacar" }],
    positions: ["Pecho izquierdo"],
    notes: "Bordado en el pecho",
  })

  it("produces valid, importable JS defining a garment matching cap.js's shape", async () => {
    const text = generateGarmentFileText(garment)
    // Write-free syntax check: importing a data: URL module confirms it parses
    // and evaluates as valid ESM, without touching the filesystem.
    const mod = await import(/* @vite-ignore */ "data:text/javascript;base64," + btoa(unescape(encodeURIComponent(text.replace('import { GENERIC_SILHOUETTE } from "./genericSilhouette.js"', 'const GENERIC_SILHOUETTE = "M0 0"')))))
    expect(mod.customPoloGarment.id).toBe("custom-polo")
    expect(mod.customPoloGarment.defaultParts).toEqual([{ id: 1, val: "3, nacar", on: true }])
    expect(mod.customPoloGarment.guides).toEqual(["M0 0", "M0 0", "M0 0", "M0 0"])
    expect(mod.customPoloGarment.callouts).toEqual([[], [], [], []])
  })

  it("flags itself as a scaffold, not a finished garment, and points to CONTRIBUTING.md", () => {
    const text = generateGarmentFileText(garment)
    expect(text).toContain("STARTING POINT for a pull request")
    expect(text).toContain("CONTRIBUTING.md")
    expect(text).toContain("TODO")
  })

  it("includes the intake chat's design notes as a comment when present", () => {
    const text = generateGarmentFileText(garment)
    expect(text).toContain("Bordado en el pecho")
  })
})
