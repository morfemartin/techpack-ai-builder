import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { FIXTURES } from "../src/layoutLab/fixtures.js"
import { ctxForFixture } from "../src/layoutLab/fixtureContext.js"
import { buildPlannedPages } from "../src/pages/interpretPlan.js"
import { illustratorLayerReport, prepareIllustratorSvg } from "../src/core/illustratorSvg.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "docs", "illustrator-comparison", "sample")
const pagesOutput = path.join(output, "pages")
const fixture = FIXTURES.find((item) => item.id === "O-complete-semantic-project")

if (!fixture) throw new Error("Missing O-complete-semantic-project fixture")

const pages = buildPlannedPages(fixture.plan, ctxForFixture(fixture), {
  includeIndex: true,
  documentMode: "illustration-handoff",
})
const page = pages.find((item) => item.id === "design-logo-pecho-reflectivo")
if (!page) throw new Error("Missing comparison page design-logo-pecho-reflectivo")

const legacySvg = page.svg
const illustratorSvg = prepareIllustratorSvg(page.svg, page)
const manifest = {
  schema: "techpack-ai-builder/illustrator-package/v1",
  generatedFrom: fixture.id,
  comparisonRule: "Both SVG files contain the same generated page and differ only in their export contract.",
  sourcePage: {
    id: page.id,
    title: page.title,
    purpose: page.purpose,
    pageNumber: page.pageNumber,
    totalPages: page.totalPages,
  },
  files: {
    legacy: "01-legacy-system.svg",
    illustrator: "02-illustrator-system.svg",
    nativeAi: "Techpack-complete.ai",
    importer: "../Techpack-Import-Illustrator.jsx",
  },
  expectedLayersBottomToTop: illustratorLayerReport(illustratorSvg),
  artboards: pages.map((item, index) => ({
    file: "pages/P" + String(index + 1).padStart(2, "0") + "--" + String(item.name || item.id).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".svg",
    id: item.id,
    title: item.title,
  })),
}

await mkdir(output, { recursive: true })
await mkdir(pagesOutput, { recursive: true })
await writeFile(path.join(output, "01-legacy-system.svg"), legacySvg, "utf8")
await writeFile(path.join(output, "02-illustrator-system.svg"), illustratorSvg, "utf8")
for (let index = 0; index < pages.length; index++) {
  const item = pages[index]
  const entry = manifest.artboards[index]
  await writeFile(path.join(output, entry.file), prepareIllustratorSvg(item.svg, item), "utf8")
}
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8")
console.log("Illustrator comparison generated in " + output)
