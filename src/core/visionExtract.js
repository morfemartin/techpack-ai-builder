// Vision intake (F1): a garment photo goes in, a "seed" compatible with
// analyzeRequirements() comes out - same door as a CSV or a typed name, just
// image-driven. Uses the same proxy/model-per-call plumbing as every other
// DeepSeek call (see deepseekClient.js) - vision just passes a different
// `model` and an OpenAI-style vision content-block instead of plain text, and
// the proxy already forwards both verbatim - no architecture change needed.

import { deepseekChatStream, DeepSeekError } from "./deepseekClient.js"
import {
  buildFocusedVisionPrompt,
  buildGarmentVisionPrompt,
  mergeFocusedVisionAnswers,
  mergeVisionAnalyses,
  normalizeVisionAnalysis,
  parseFocusedVisionAnswer,
  parseVisionJSON,
  visionAnalysisToSeed,
} from "./visionContract.js"

// Overridable via env for live A/B testing between vision model sizes
// without a code change (same pattern as VITE_DEEPSEEK_PROXY_URL).
const DEFAULT_VISION_MODEL = import.meta.env.VITE_NVIDIA_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct"

// Keeps a multi-photo request well under Vercel's ~4.5MB body cap.
const MAX_DOWNSCALE_DIM = 1024
const MAX_VISION_CONCURRENCY = 3
let currentVisionConcurrency = MAX_VISION_CONCURRENCY

// Resilience/rate-limit tuning (the vision fan-out was a top contributor to
// NVIDIA rate-limit exhaustion - see the hybrid budget/circuit-breaker fixes):
//  · VISION_MAX_ATTEMPTS 2 = one capacity-only retry (503/504) with the
//    client's built-in 1.5s backoff, instead of dropping a pass on the first
//    transient rate-limit hit.
//  · VISION_MAX_QUADRANTS 2 = process at most the first two detail crops per
//    photo (quadrants only ADD low-rank detail the full passes couldn't
//    resolve - mergeVisionAnalyses ranks them lowest - so halving them barely
//    moves coverage while cutting calls). Tunable; validate with
//    `npm run benchmark:vision` before trusting a lower value.
// Rate is kept in check by the ≤3 concurrency cap (which self-drops to 1 on a
// 503), the capacity-only retry with backoff, and the ~40% fewer calls per
// photo - no global start-pacing (it would serialize the concurrency model).
const VISION_MAX_ATTEMPTS = 2
const VISION_MAX_QUADRANTS = 2

// `currentVisionConcurrency` self-drops to 1 on a 503 and, by design, STAYS
// there for the rest of the session - that is the point of the back-off. In a
// test file that makes it leak across cases: one test simulating a 503 leaves
// every later test running serialized, which silently changed both the call
// count and which images got processed. Mirrors resetHybridAIForTests()
// (hybridAI.js), which exists for exactly this reason.
export function resetVisionConcurrencyForTests() {
  currentVisionConcurrency = MAX_VISION_CONCURRENCY
}

// Pure: the largest {width, height} that fits within maxDim on its longest
// side while keeping the original aspect ratio. Never upscales.
export function computeDownscaleDims(width, height, maxDim = MAX_DOWNSCALE_DIM) {
  if (!width || !height) return { width, height }
  if (width <= maxDim && height <= maxDim) return { width, height }
  const scale = maxDim / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// Shared FileReader+Image() decode step - factored out so a photo is only
// ever decoded ONCE per call site. downscaleImage() and
// splitImageIntoQuadrants() both build on this instead of each reading the
// file separately.
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = ev.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Crops a (sx,sy,sWidth,sHeight) source rect out of an already-loaded image,
// downscaling that crop independently to maxDim - used both for the "whole
// photo" case (source rect = the entire image) and for a single quadrant
// (source rect = one quarter of it, at NATIVE resolution, so the crop keeps
// real detail instead of detail already lost by shrinking the whole photo
// first).
function cropToBase64(img, sx, sy, sWidth, sHeight, maxDim) {
  const { width, height } = computeDownscaleDims(sWidth, sHeight, maxDim)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d").drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height)
  return { base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], width, height }
}

// Client-side downscale via canvas. Returns base64 WITHOUT the data: prefix.
export function downscaleImage(file, maxDim = MAX_DOWNSCALE_DIM) {
  return loadImageElement(file).then((img) => {
    const { base64, width, height } = cropToBase64(img, 0, 0, img.naturalWidth, img.naturalHeight, maxDim)
    return { fileName: file.name, base64, width, height }
  })
}

// Pure: the four 2x2-grid crop rects (native pixel coords) a photo splits
// into - kept separate from the canvas-touching code below so the geometry
// itself is unit-testable without a DOM Image/canvas.
export function quadrantRects(width, height) {
  const hw = width / 2
  const hh = height / 2
  return [
    { sx: 0, sy: 0, sWidth: hw, sHeight: hh, quadrantLabel: "superior izquierdo" },
    { sx: hw, sy: 0, sWidth: hw, sHeight: hh, quadrantLabel: "superior derecho" },
    { sx: 0, sy: hh, sWidth: hw, sHeight: hh, quadrantLabel: "inferior izquierdo" },
    { sx: hw, sy: hh, sWidth: hw, sHeight: hh, quadrantLabel: "inferior derecho" },
  ]
}

// F1.5: splits one uploaded photo into a whole-image read PLUS 4 quadrant
// close-ups, each cropped from the native-resolution image before being
// downscaled - so each quadrant keeps roughly 2x the effective detail a
// same-size crop of the already-shrunk whole photo would have. Feeds
// extractGarmentFromImages() below (tagged full/quadrant) to fix "vague on
// fine detail" - the whole-photo pass still drives garmentType/general
// attributes, quadrants only add detail the whole photo couldn't resolve.
export function splitImageIntoQuadrants(file, maxDim = MAX_DOWNSCALE_DIM) {
  return loadImageElement(file).then((img) => {
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const fullCrop = cropToBase64(img, 0, 0, nw, nh, maxDim)
    const full = { fileName: file.name, base64: fullCrop.base64, width: fullCrop.width, height: fullCrop.height, kind: "full" }
    const quadrants = quadrantRects(nw, nh).map((r) => {
      const crop = cropToBase64(img, r.sx, r.sy, r.sWidth, r.sHeight, maxDim)
      return { fileName: file.name, base64: crop.base64, width: crop.width, height: crop.height, kind: "quadrant", quadrantLabel: r.quadrantLabel }
    })
    return { full, quadrants }
  })
}

// Pure: normalizes the vision model's JSON reply into the {garmentType, seed}
// shape analyzeRequirements() expects as its `seed` argument - tolerant of
// markdown fences and missing/malformed fields, same defensive style as
// normalizeRequirements() (techpackRequirements.js).
export function parseVisionSeed(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return { garmentType: "", seed: {} }
  }
  const garmentType = typeof parsed.garmentType === "string" ? parsed.garmentType.trim() : ""
  const rawSeed = parsed.seed && typeof parsed.seed === "object" && !Array.isArray(parsed.seed) ? parsed.seed : {}
  const seed = {}
  for (const key of Object.keys(rawSeed)) {
    const val = rawSeed[key]
    if (typeof val === "string" && val.trim()) seed[key] = val.trim()
  }
  return { garmentType, seed }
}

// Pure: combines one {garmentType, seed} result per photo into a single
// seed - the first photo's garmentType wins (usually the primary/front
// shot), and for each attribute key, whichever photo reported it FIRST
// wins too, so a later, less-certain angle can't overwrite a clear reading
// from an earlier one. A detail only a later photo caught (e.g. a back-view
// closure) still gets folded in under its own key.
export function mergeVisionSeeds(results) {
  const withType = results.find((r) => r.garmentType)
  const garmentType = withType ? withType.garmentType : ""
  const seed = {}
  for (const r of results) {
    for (const key of Object.keys(r.seed || {})) {
      if (!(key in seed)) seed[key] = r.seed[key]
    }
  }
  return { garmentType, seed }
}

export function summarizeVisionProgress(text) {
  const clean = String(text || "").replace(/```json|```/g, "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  return clean.length > 140 ? clean.slice(0, 137) + "..." : clean
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit || 1), items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const current = nextIndex
        nextIndex += 1
        results[current] = await worker(items[current], current)
      }
    })
  )
  return results
}

export function buildVisionMessages(base64, { kind, quadrantLabel, pass, garmentType } = {}) {
  const text = buildGarmentVisionPrompt({ kind, quadrantLabel, pass, garmentType })
  return [
    {
      role: "user",
      content: [
        { type: "text", text },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64 } },
      ],
    },
  ]
}

// One DeepSeek vision call per photo (or per photo-quadrant) - the vision
// model NVIDIA serves here only accepts a single image per request (confirmed
// live: sending more than one throws "At most 1 image(s) may be provided in
// one request"), so a multi-photo upload runs one call per image and merges
// the results via mergeVisionSeeds() instead of packing every image into one
// message. Vision is still just another door into the same reasoning core
// the CSV import and "prenda desde 0" chat already share - only the shape of
// the DeepSeek call changed, not what comes out of it.
//
// `images` entries may optionally carry `{ photoIndex, photoTotal, kind:
// "full"|"quadrant", quadrantLabel }` (see splitImageIntoQuadrants + App.jsx's
// upload handler, which flattens each photo's full+4-quadrant set with these
// tags). Every path goes through an ordered, max-3 concurrency queue. That
// keeps the full+4 pass detailed without creating a synchronized retry
// stampede against NVIDIA's fragile free-tier capacity, and still preserves
// merge order: photo 1/full first, then its quadrants, then later photos.
export async function extractDetailedGarmentFromImages(images, { lang = "ES", model, onProgress } = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new DeepSeekError("No hay imagenes para analizar.", { images })
  }

  function callFor(img, i, promptOptions = {}) {
    const photoIndex = img.photoIndex !== undefined ? img.photoIndex : i
    const photoTotal = img.photoTotal !== undefined ? img.photoTotal : images.length
    const kind = img.kind || "full"
    const label = promptOptions.pass === "artwork"
      ? "Revisando disenos visibles de la foto " + (photoIndex + 1) + " de " + photoTotal + "..."
      : promptOptions.pass === "surface"
      ? "Revisando arte y acabados de la foto " + (photoIndex + 1) + " de " + photoTotal + "..."
      : promptOptions.pass === "orientation"
      ? "Confirmando orientacion de la foto " + (photoIndex + 1) + " de " + photoTotal + "..."
      : promptOptions.pass === "classification"
      ? "Confirmando tipo de prenda en la foto " + (photoIndex + 1) + " de " + photoTotal + "..."
      : promptOptions.pass === "verification"
      ? "Validando detalles criticos de la foto " + (photoIndex + 1) + " de " + photoTotal + "..."
      : promptOptions.pass === "construction"
      ? "Verificando construccion de la foto " + (photoIndex + 1) + " de " + photoTotal + "..."
      : kind === "quadrant"
      ? "Analizando foto " + (photoIndex + 1) + " de " + photoTotal + " - detalle " + (img.quadrantLabel || "") + "..."
      : "Analizando foto " + (photoIndex + 1) + " de " + photoTotal + "..."
    return deepseekChatStream({
      messages: buildVisionMessages(img.base64, { kind, quadrantLabel: img.quadrantLabel, ...promptOptions }),
      model: model || DEFAULT_VISION_MODEL,
      maxTokens: promptOptions.pass === "construction" ? 600 : ["verification", "surface", "artwork"].includes(promptOptions.pass) ? 400 : ["classification", "orientation"].includes(promptOptions.pass) ? 220 : 900,
      temperature: promptOptions.pass === "identity" ? 0.1 : 0,
      provider: "nvidia",
      timeoutMs: kind === "quadrant" ? 15000 : 30000,
      maxAttempts: VISION_MAX_ATTEMPTS,
      retryCapacityOnly: true,
      onEvent: onProgress
        ? ({ contentSoFar, deltaText, tokensSoFar }) => {
            onProgress({
              imageIndex: i,
              imageNumber: i + 1,
              total: images.length,
              photoIndex,
              photoTotal,
              kind,
              pass: promptOptions.pass || (kind === "quadrant" ? "detail" : "identity"),
              label,
              partialText: summarizeVisionProgress(contentSoFar),
              contentSoFar,
              deltaText,
              tokensSoFar,
            })
          }
        : undefined,
    }).then((raw) => normalizeVisionAnalysis(parseVisionJSON(raw), { kind, quadrantLabel: img.quadrantLabel, pass: promptOptions.pass })).catch((error) => {
      if (error && (error.status === 503 || error.status === 504)) currentVisionConcurrency = 1
      throw error
    })
  }

  const hasPhotoGroups = images.some((img) => img && img.photoIndex !== undefined)
  if (!hasPhotoGroups) {
    const settled = await mapWithConcurrency(images, currentVisionConcurrency, async (img, i) => {
      try { return { ok: true, value: await callFor(img, i) } } catch (error) { return { ok: false, error } }
    })
    const results = settled.filter((item) => item.ok).map((item) => item.value)
    if (results.length === 0) throw settled[0].error
    const analysis = mergeVisionAnalyses(results)
    const seed = Object.keys(analysis.legacySeed || {}).length > 0 ? analysis.legacySeed : visionAnalysisToSeed(analysis)
    return { garmentType: analysis.garmentType, seed, analysis }
  }

  const groups = new Map()
  images.forEach((img, i) => {
    const key = img.photoIndex !== undefined ? img.photoIndex : i
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push([img, i])
  })
  const results = []
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const entries = groups.get(key)
    const full = entries.find(([img]) => (img.kind || "full") === "full")
    if (full) {
      const identity = await callFor(full[0], full[1], { pass: "identity" })
      results.push(identity)
      let family = identity.garmentType
      if (!family) {
        try {
          const classification = await callFor(full[0], full[1], { pass: "classification" })
          results.push(classification)
          family = classification.garmentType
        } catch {}
      }
      try {
        results.push(await callFor(full[0], full[1], { pass: "orientation", garmentType: family }))
      } catch {}
      try {
        results.push(await callFor(full[0], full[1], { pass: "construction", garmentType: family }))
      } catch (error) {
        if (error && (error.status === 503 || error.status === 504)) currentVisionConcurrency = 1
      }
      try {
        results.push(await callFor(full[0], full[1], { pass: "verification", garmentType: family }))
      } catch (error) {
        if (error && (error.status === 503 || error.status === 504)) currentVisionConcurrency = 1
      }
      // `surface` dropped: its signal (fit/shoulder/cuffs/hem + artwork) is
      // already covered by the construction pass + the artwork pass, so it was
      // a near-duplicate call against the rate limit.
      try {
        results.push(await callFor(full[0], full[1], { pass: "artwork", garmentType: family }))
      } catch {}
    }
    // Cap detail crops per photo - quadrants only add low-rank supplementary
    // detail, so processing the first VISION_MAX_QUADRANTS keeps coverage while
    // roughly halving the detail calls against NVIDIA's rate limit.
    const details = entries.filter((entry) => entry !== full).slice(0, VISION_MAX_QUADRANTS)
    const settled = await mapWithConcurrency(details, currentVisionConcurrency, async ([img, i]) => {
      try { return await callFor(img, i) } catch { return null }
    })
    results.push(...settled.filter(Boolean))
  }
  const analysis = mergeVisionAnalyses(results)
  const seed = Object.keys(analysis.legacySeed || {}).length > 0 ? analysis.legacySeed : visionAnalysisToSeed(analysis)
  return { garmentType: analysis.garmentType, seed, analysis }
}

export async function extractGarmentFromImages(images, options = {}) {
  const result = await extractDetailedGarmentFromImages(images, options)
  return { garmentType: result.garmentType, seed: result.seed }
}

// Single targeted vision call (deliberately NOT quadrant-split - this answers
// ONE question quickly, it isn't the exhaustive intake pass) used when the
// user attaches a photo mid-chat to answer whatever field is currently on
// screen instead of typing. Returns a short plain-text answer, not a seed.
export async function answerFieldFromImage({ field, garmentType, imageBase64, lang = "ES", onProgress }) {
  const f = field || {}
  const optionsText = Array.isArray(f.options) && f.options.length > 0 ? " Opciones validas si alguna coincide claramente: " + f.options.join(", ") + "." : ""
  const instructions =
    "Sos un tecnico textil experto mirando una foto de una prenda tipo '" + (garmentType || "prenda") + "'. " +
    "Tu tarea es responder SOLO el campo actual: \"" + (f.label || "") + "\"." + optionsText + " " +
    "Usa unicamente evidencia visible en la foto. No completes sub-datos relacionados al campo si no se ven de forma directa. " +
    "Nunca inventes peso/GSM, costo, composicion exacta, porcentaje, medidas, caida numerica, calibre, proveedor ni tecnica de fabricacion salvo que aparezcan escritos o sean visualmente inequívocos. " +
    "Para tela, describe solo lo que se puede ver (por ejemplo: aparente felpa, pique, jersey, tejido liso, textura acanalada) y agrega 'aparente' cuando no haya certeza. " +
    "Si la foto no permite determinar el campo actual con certeza, responde exactamente: \"No se puede determinar con certeza desde la foto.\" " +
    "Devolve SOLO una respuesta corta en espanol, sin explicacion extra ni JSON."

  const raw = await deepseekChatStream({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instructions },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + imageBase64 } },
        ],
      },
    ],
    model: DEFAULT_VISION_MODEL,
    maxTokens: 200,
    temperature: 0.2,
    provider: "nvidia",
    timeoutMs: 30000,
    maxAttempts: VISION_MAX_ATTEMPTS,
    retryCapacityOnly: true,
    onEvent: onProgress
      ? ({ contentSoFar, tokensSoFar }) => onProgress({ partialText: summarizeVisionProgress(contentSoFar), tokensSoFar })
      : undefined,
  })
  return raw.replace(/```/g, "").trim()
}

async function focusedSegmentCall({ field, garmentType, segment, index, total, onProgress }) {
  const raw = await deepseekChatStream({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: buildFocusedVisionPrompt(field, garmentType, segment) },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + segment.base64 } },
      ],
    }],
    model: DEFAULT_VISION_MODEL,
    maxTokens: 320,
    temperature: 0.1,
    provider: "nvidia",
    timeoutMs: segment.kind === "quadrant" ? 15000 : 30000,
    maxAttempts: VISION_MAX_ATTEMPTS,
    retryCapacityOnly: true,
    onEvent: onProgress
      ? ({ contentSoFar, tokensSoFar }) => onProgress({
          segmentIndex: index,
          segmentNumber: index + 1,
          totalSegments: total,
          kind: segment.kind || "full",
          quadrantLabel: segment.quadrantLabel || "",
          label: segment.kind === "quadrant" ? "Detalle " + segment.quadrantLabel : "Vista completa",
          partialText: summarizeVisionProgress(contentSoFar),
          tokensSoFar,
        })
      : undefined,
  })
  return parseFocusedVisionAnswer(raw, segment)
}

// High-fidelity mid-chat analysis: the current field is evaluated against the
// full photo first, then up to VISION_MAX_QUADRANTS independently cropped
// quadrants. A deterministic reducer selects the strongest visible answer; it
// never auto-submits it.
export async function answerFieldFromImageSegments({ field, garmentType, segments, onProgress }) {
  const safe = Array.isArray(segments) ? segments.filter((segment) => segment && segment.base64) : []
  if (safe.length === 0) throw new DeepSeekError("No hay segmentos de imagen para analizar.")
  const fullIndex = safe.findIndex((segment) => (segment.kind || "full") === "full")
  const full = fullIndex >= 0 ? safe[fullIndex] : safe[0]
  const details = safe.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment !== full).slice(0, VISION_MAX_QUADRANTS)
  // total reflects what will ACTUALLY be processed (full + capped details), so
  // the progress read-out ("segmento X de N") matches reality.
  const total = 1 + details.length
  const fullResult = await focusedSegmentCall({ field, garmentType, segment: full, index: fullIndex >= 0 ? fullIndex : 0, total, onProgress })
  const detailResults = await mapWithConcurrency(details, currentVisionConcurrency, async ({ segment, index }) => {
    try {
      return await focusedSegmentCall({ field, garmentType, segment, index, total, onProgress })
    } catch (error) {
      if (error && (error.status === 503 || error.status === 504)) currentVisionConcurrency = 1
      return null
    }
  })
  return mergeFocusedVisionAnswers([fullResult, ...detailResults.filter(Boolean)])
}
