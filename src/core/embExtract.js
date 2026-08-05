// Restores the "upload a Wilcom production worksheet PDF, get the embroidery
// spec fields back" feature - previously routed through claudeApi.js's direct
// Anthropic call, which required a VITE_ANTHROPIC_API_KEY nobody had
// configured (silently returning null - see EmbForm.jsx's former "PDF
// extraido" lie). Mistral has a dedicated OCR API built for exactly this
// (structured extraction from a scanned/production document), and the
// studio bridge already custodies the Mistral key server-side the same way
// api/deepseek.js custodies NVIDIA's - so this never needs its own key in
// the client, unlike the old Anthropic path.
//
// Two-step pipeline, both hops through the SAME bridge:
//   1. getLocalOcrText() - Mistral's /v1/ocr turns the PDF into plain text.
//   2. extractStructured() - a normal chat call (the same transport/prompt
//      pattern csvImport.js already uses for the identical emb key list)
//      turns that OCR text into the structured {machine, stitches, ...}
//      object EmbForm.jsx expects.
//
// Studio-only by construction: getLocalOcrText() calls the bridge's /v1/ocr
// route, which the bridge itself refuses (501) unless it is Mistral-backed
// (see studioBridge.mjs) - the public/NVIDIA build has no such bridge at
// all, so this throws immediately there rather than attempting a request
// that could only fail.
import { getLocalOcrText, extractStructured, getTextAIProvider } from "./deepseekClient.js"
import { EMB_FIELDS_PROMPT } from "./helpers.js"
import { canonicalizeStopSeq } from "./madeiraThreads.js"

export class EmbExtractError extends Error {}

// Returns { emb, corrections }: emb is the EMPTY_EMB-shaped object EmbForm.jsx
// expects (unchanged shape, so existing callers/data don't need to know this
// happened); corrections lists every stop whose code/name got reconciled
// against the official Madeira chart, for the UI to surface instead of
// silently rewriting what the Wilcom sheet said - see canonicalizeStopSeq.
export async function extractEmbFromPDF(base64) {
  if (getTextAIProvider() !== "local") {
    throw new EmbExtractError("La extraccion de PDF Wilcom solo esta disponible en la version estudio (studio.html) con Mistral.")
  }
  const text = await getLocalOcrText(base64)
  if (!text || !text.trim()) {
    throw new EmbExtractError("El OCR no encontro texto legible en este PDF.")
  }
  const instructions =
    "Este es el texto OCR de una ficha de digitalizado de bordado (Wilcom Production Worksheet). " +
    "Extrae los datos de bordado y devolve SOLO un objeto JSON con estas claves exactas (string vacio o array vacio si no encontras el dato): " +
    EMB_FIELDS_PROMPT + "."
  const result = await extractStructured({ instructions, content: text, maxTokens: 1200 })
  const emb = result && typeof result === "object" ? result : {}
  if (!Array.isArray(emb.stopSeq) || emb.stopSeq.length === 0) return { emb, corrections: [] }
  const { stopSeq, corrections } = canonicalizeStopSeq(emb.stopSeq)
  return { emb: { ...emb, stopSeq }, corrections }
}
