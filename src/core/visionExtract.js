// Vision intake (F1): a garment photo goes in, a "seed" compatible with
// analyzeRequirements() comes out - same door as a CSV or a typed name, just
// image-driven. Uses the same proxy/model-per-call plumbing as every other
// DeepSeek call (see deepseekClient.js) - vision just passes a different
// `model` and an OpenAI-style vision content-block instead of plain text, and
// the proxy already forwards both verbatim - no architecture change needed.

import { deepseekChatStream, DeepSeekError } from "./deepseekClient.js"

// Overridable via env for live A/B testing between vision model sizes
// without a code change (same pattern as VITE_DEEPSEEK_PROXY_URL).
const DEFAULT_VISION_MODEL = import.meta.env.VITE_NVIDIA_VISION_MODEL || "meta/llama-3.2-90b-vision-instruct"

// Keeps a multi-photo request well under Vercel's ~4.5MB body cap.
const MAX_DOWNSCALE_DIM = 1024
const MAX_VISION_CONCURRENCY = 3

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

function buildVisionMessages(base64, { kind, quadrantLabel } = {}) {
  const isQuadrant = kind === "quadrant"
  const text = isQuadrant
    ? "Sos un tecnico textil experto mirando UN RECORTE/ACERCAMIENTO (" + (quadrantLabel || "detalle") + ") de una foto MAS GRANDE de una prenda real - " +
      "no estas viendo la prenda completa, solo esta porcion ampliada. Enfocate en el MAXIMO DETALLE visible en este recorte especifico: " +
      "costuras, textura de tela, hardware, botones, cierres, texto/etiquetas, terminaciones. Extrae SOLO los atributos que se ven con certeza " +
      "EN ESTE RECORTE - no inventes nada que no se vea con claridad, y no adivines el tipo de prenda completo desde un recorte parcial " +
      "(dejá \"garmentType\" vacio). Devolve SOLO un objeto JSON con esta forma exacta, sin markdown: " +
      '{"garmentType": "", "seed": {"Atributo": "valor visible en este recorte"}}'
    : "Sos un tecnico textil experto mirando una foto de una prenda real. Identifica que tipo de prenda es " +
      "y extrae SOLO los atributos que se ven con certeza en la foto: color, tela aparente, cuello, " +
      "manga, cierre, bolsillos, costuras visibles, etc. No inventes nada que no se vea con claridad. " +
      "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown: " +
      '{"garmentType": "nombre de la prenda en espanol", "seed": {"Atributo": "valor visible"}}'
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
export async function extractGarmentFromImages(images, { lang = "ES", model, onProgress } = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new DeepSeekError("No hay imagenes para analizar.", { images })
  }

  function callFor(img, i) {
    const photoIndex = img.photoIndex !== undefined ? img.photoIndex : i
    const photoTotal = img.photoTotal !== undefined ? img.photoTotal : images.length
    const kind = img.kind || "full"
    const label = kind === "quadrant"
      ? "Analizando foto " + (photoIndex + 1) + " de " + photoTotal + " - detalle " + (img.quadrantLabel || "") + "..."
      : "Analizando foto " + (photoIndex + 1) + " de " + photoTotal + "..."
    return deepseekChatStream({
      messages: buildVisionMessages(img.base64, { kind, quadrantLabel: img.quadrantLabel }),
      model: model || DEFAULT_VISION_MODEL,
      maxTokens: 1200,
      temperature: 0.2,
      onEvent: onProgress
        ? ({ contentSoFar, deltaText, tokensSoFar }) => {
            onProgress({
              imageIndex: i,
              imageNumber: i + 1,
              total: images.length,
              photoIndex,
              photoTotal,
              kind,
              label,
              partialText: summarizeVisionProgress(contentSoFar),
              contentSoFar,
              deltaText,
              tokensSoFar,
            })
          }
        : undefined,
    }).then(parseVisionSeed)
  }

  const hasPhotoGroups = images.some((img) => img && img.photoIndex !== undefined)
  if (!hasPhotoGroups) {
    const results = await mapWithConcurrency(images, MAX_VISION_CONCURRENCY, (img, i) => callFor(img, i))
    return mergeVisionSeeds(results)
  }

  const groups = new Map()
  images.forEach((img, i) => {
    const key = img.photoIndex !== undefined ? img.photoIndex : i
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push([img, i])
  })
  const results = []
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const batchResults = await mapWithConcurrency(groups.get(key), MAX_VISION_CONCURRENCY, ([img, i]) => callFor(img, i))
    results.push(...batchResults)
  }
  return mergeVisionSeeds(results)
}

// Single targeted vision call (deliberately NOT quadrant-split - this answers
// ONE question quickly, it isn't the exhaustive intake pass) used when the
// user attaches a photo mid-chat to answer whatever field is currently on
// screen instead of typing. Returns a short plain-text answer, not a seed.
export async function answerFieldFromImage({ field, garmentType, imageBase64, lang = "ES" }) {
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
  })
  return raw.replace(/```/g, "").trim()
}
