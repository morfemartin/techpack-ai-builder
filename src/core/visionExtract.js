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

// One DeepSeek vision call: given one or more downscaled images (from
// downscaleImage() above), asks the vision model what garment it sees and
// what's visible about it, returning a seed in the exact shape
// analyzeRequirements() consumes - vision is just another door into the same
// reasoning core the CSV import and "prenda desde 0" chat already share.
export async function extractGarmentFromImages(images, { lang = "ES", model } = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new DeepSeekError("No hay imagenes para analizar.", { images })
  }

  const content = [
    {
      type: "text",
      text:
        "Sos un tecnico textil experto mirando foto(s) de una prenda real. Identifica que tipo de prenda es " +
        "y extrae SOLO los atributos que se ven con certeza en la(s) foto(s): color, tela aparente, cuello, " +
        "manga, cierre, bolsillos, costuras visibles, etc. No inventes nada que no se vea con claridad. " +
        "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown: " +
        '{"garmentType": "nombre de la prenda en espanol", "seed": {"Atributo": "valor visible"}}',
    },
    ...images.map((img) => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + img.base64 } })),
  ]

  const raw = await deepseekChat({
    messages: [{ role: "user", content }],
    model: model || DEFAULT_VISION_MODEL,
    maxTokens: 1200,
    temperature: 0.2,
  })

  return parseVisionSeed(raw)
}
