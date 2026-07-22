import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { VISION_PROMPT_VERSION, buildGarmentVisionPrompt, mergeVisionAnalyses, normalizeVisionAnalysis, parseVisionJSON, visionAnalysisToSeed } from "../src/core/visionContract.js"
import { scoreVisionResult, summarizeVisionBenchmark } from "../src/core/visionBenchmark.js"

const execFileAsync = promisify(execFile)
const repoRoot = new URL("..", import.meta.url).pathname
const groundTruthPath = join(repoRoot, "benchmarks/vision/ground-truth.json")
const outputPath = join(repoRoot, "benchmarks/vision/results/latest.json")
const datasetRoot = process.env.TECHPACK_VISION_DATASET || "/Users/martinmorfe/Documents/Dataset-Imagenes para techack"
const endpoint = process.env.TECHPACK_VISION_ENDPOINT || "http://localhost:3000/api/deepseek"
const model = process.env.TECHPACK_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct"
const selectedId = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5)

async function imageDimensions(path) {
  const { stdout } = await execFileAsync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path])
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1])
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1])
  if (!width || !height) throw new Error("No se pudieron leer las dimensiones de " + path)
  return { width, height }
}

async function prepareSegments(path, tempRoot) {
  const { width, height } = await imageDimensions(path)
  const fullPath = join(tempRoot, "full.jpg")
  await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", "1024", path, "--out", fullPath])
  const halfW = Math.floor(width / 2)
  const halfH = Math.floor(height / 2)
  const specs = [
    ["superior izquierdo", 0, 0],
    ["superior derecho", 0, width - halfW],
    ["inferior izquierdo", height - halfH, 0],
    ["inferior derecho", height - halfH, width - halfW],
  ]
  const segments = [{ kind: "full", quadrantLabel: "", path: fullPath }]
  for (let index = 0; index < specs.length; index++) {
    const [quadrantLabel, y, x] = specs[index]
    const output = join(tempRoot, `quadrant-${index + 1}.jpg`)
    await execFileAsync("/usr/bin/sips", ["-c", String(halfH), String(halfW), "--cropOffset", String(y), String(x), "-s", "format", "jpeg", path, "--out", output])
    segments.push({ kind: "quadrant", quadrantLabel, path: output })
  }
  return segments
}

async function callVision(segment, promptOptions = {}) {
  const base64 = (await readFile(segment.path)).toString("base64")
  const controller = new AbortController()
  const timeoutMs = segment.kind === "quadrant" ? 12000 : 30000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      max_tokens: promptOptions.pass === "construction" ? 600 : ["verification", "surface", "artwork"].includes(promptOptions.pass) ? 400 : ["classification", "orientation"].includes(promptOptions.pass) ? 220 : 900,
      temperature: promptOptions.pass === "identity" ? 0.1 : 0,
      messages: [{ role: "user", content: [
        { type: "text", text: buildGarmentVisionPrompt({ ...segment, ...promptOptions }) },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64 } },
      ] }],
    }),
    })
  } finally {
    clearTimeout(timer)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.detail || body.error || `HTTP ${response.status}`), { status: response.status })
  const content = body?.choices?.[0]?.message?.content
  if (!content) throw new Error("Respuesta visual vacia")
  return normalizeVisionAnalysis(parseVisionJSON(content), { ...segment, pass: promptOptions.pass })
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

async function runFixture(fixture) {
  const sourcePath = join(datasetRoot, fixture.fileName)
  const tempRoot = await mkdtemp(join(tmpdir(), "techpack-vision-"))
  const startedAt = Date.now()
  try {
    const segments = await prepareSegments(sourcePath, tempRoot)
    process.stdout.write(`[vision] ${fixture.id}: vista completa\n`)
    const identity = await callVision(segments[0], { pass: "identity" })
    let classification = null
    let family = identity.garmentType
    if (!family) {
      try {
        classification = await callVision(segments[0], { pass: "classification" })
        family = classification.garmentType
      } catch {}
    }
    let orientation = null
    try {
      orientation = await callVision(segments[0], { pass: "orientation", garmentType: family })
    } catch (error) {
      process.stdout.write(`[vision] ${fixture.id}: orientacion parcial (${error.name === "AbortError" ? "timeout" : "error"})\n`)
    }
    let construction = null
    try {
      construction = await callVision(segments[0], { pass: "construction", garmentType: family })
    } catch (error) {
      process.stdout.write(`[vision] ${fixture.id}: construccion parcial (${error.name === "AbortError" ? "timeout" : "error"})\n`)
    }
    let verification = null
    try {
      verification = await callVision(segments[0], { pass: "verification", garmentType: family })
    } catch (error) {
      process.stdout.write(`[vision] ${fixture.id}: verificacion parcial (${error.name === "AbortError" ? "timeout" : "error"})\n`)
    }
    let surface = null
    try {
      surface = await callVision(segments[0], { pass: "surface", garmentType: family })
    } catch (error) {
      process.stdout.write(`[vision] ${fixture.id}: superficie parcial (${error.name === "AbortError" ? "timeout" : "error"})\n`)
    }
    let artwork = null
    try {
      artwork = await callVision(segments[0], { pass: "artwork", garmentType: family })
    } catch (error) {
      process.stdout.write(`[vision] ${fixture.id}: arte parcial (${error.name === "AbortError" ? "timeout" : "error"})\n`)
    }
    process.stdout.write(`[vision] ${fixture.id}: cuatro cuadrantes\n`)
    const details = await mapWithLimit(segments.slice(1), 3, async (segment) => {
      try { return await callVision(segment) } catch { return null }
    })
    const analysis = mergeVisionAnalyses([identity, classification, orientation, construction, verification, surface, artwork, ...details].filter(Boolean))
    const result = { garmentType: analysis.garmentType, seed: visionAnalysisToSeed(analysis), analysis }
    const score = scoreVisionResult(result, { ...fixture, minimumAffinity: groundTruth.minimumAffinity })
    return { id: fixture.id, fileName: basename(sourcePath), latencyMs: Date.now() - startedAt, result, score }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

const groundTruth = JSON.parse(await readFile(groundTruthPath, "utf8"))
const fixtures = groundTruth.items.filter((fixture) => !selectedId || fixture.id === selectedId)
if (fixtures.length === 0) throw new Error("No existe el fixture solicitado")
const entries = []
for (const fixture of fixtures) {
  try {
    entries.push(await runFixture(fixture))
  } catch (error) {
    entries.push({ id: fixture.id, fileName: fixture.fileName, error: String(error.message || error), score: { affinity: 0, passed: false } })
  }
}
const report = {
  schemaVersion: "techpack-vision-benchmark/v1",
  generatedAt: new Date().toISOString(),
  endpoint,
  model,
  promptVersion: VISION_PROMPT_VERSION,
  summary: summarizeVisionBenchmark(entries, groundTruth.minimumAffinity),
  entries,
}
await mkdir(join(repoRoot, "benchmarks/vision/results"), { recursive: true })
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n")
process.stdout.write(JSON.stringify(report.summary, null, 2) + "\n")
if (!report.summary.allPassed) process.exitCode = 2
