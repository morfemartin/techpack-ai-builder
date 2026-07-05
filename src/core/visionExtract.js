// Vision intake (F1): a garment photo goes in, a "seed" compatible with
// analyzeRequirements() comes out - same door as a CSV or a typed name, just
// image-driven. Uses the same proxy/model-per-call plumbing as every other
// DeepSeek call (see deepseekClient.js) - vision just passes a different
// `model` and an OpenAI-style vision content-block instead of plain text, and
// the proxy already forwards both verbatim - no architecture change needed.

import { deepseekChat, DeepSeekError } from "./deepseekClient.js"

// Overridable via env for live A/B testing between vision model sizes
// without a code change (same pattern as VITE_DEEPSEEK_PROXY_URL).
const DEFAULT_VISION_MODEL = import.meta.env.VITE_NVIDIA_VISION_MODEL || "meta/llama-3.2-90b-vision-instruct"

// Keeps a multi-photo request well under Vercel's ~4.5MB body cap.
const MAX_DOWNSCALE_DIM = 1024

// Pure: the largest {width, height} that fits within maxDim on its longest
// side while keeping the original aspect ratio. Never upscales.
export function computeDownscaleDims(width, height, maxDim = MAX_DOWNSCALE_DIM) {
  if (!width || !height) return { width, height }
  if (width <= maxDim && height <= maxDim) return { width, height }
  const scale = maxDim / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// Client-side downscale via canvas - reuses the FileReader/Image() decode
// pattern from ImageUploader.jsx/readImageFile (App.jsx), adding a canvas
// resize step before re-encoding. Returns base64 WITHOUT the data: prefix.
export function downscaleImage(file, maxDim = MAX_DOWNSCALE_DIM) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const { width, height } = computeDownscaleDims(img.naturalWidth, img.naturalHeight, maxDim)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        canvas.getContext("2d").drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85)
        resolve({ fileName: file.name, base64: dataUrl.split(",")[1], width, height })
      }
      img.onerror = reject
      img.src = ev.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
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

function buildVisionMessages(base64) {
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            "Sos un tecnico textil experto mirando una foto de una prenda real. Identifica que tipo de prenda es " +
            "y extrae SOLO los atributos que se ven con certeza en la foto: color, tela aparente, cuello, " +
            "manga, cierre, bolsillos, costuras visibles, etc. No inventes nada que no se vea con claridad. " +
            "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown: " +
            '{"garmentType": "nombre de la prenda en espanol", "seed": {"Atributo": "valor visible"}}',
        },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64 } },
      ],
    },
  ]
}

// One DeepSeek vision call per photo - the vision model NVIDIA serves here
// only accepts a single image per request (confirmed live: sending more than
// one throws "At most 1 image(s) may be provided in one request"), so a
// multi-photo upload runs one call per photo in parallel and merges the
// results via mergeVisionSeeds() instead of packing every image into one
// message. Vision is still just another door into the same reasoning core
// the CSV import and "prenda desde 0" chat already share - only the shape of
// the DeepSeek call changed, not what comes out of it.
export async function extractGarmentFromImages(images, { lang = "ES", model } = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new DeepSeekError("No hay imagenes para analizar.", { images })
  }

  const results = await Promise.all(
    images.map((img) =>
      deepseekChat({
        messages: buildVisionMessages(img.base64),
        model: model || DEFAULT_VISION_MODEL,
        maxTokens: 1200,
        temperature: 0.2,
      }).then(parseVisionSeed)
    )
  )

  return mergeVisionSeeds(results)
}
