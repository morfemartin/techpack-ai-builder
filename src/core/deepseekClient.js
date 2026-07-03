// Client-side helper. Calls OUR OWN proxy (/api/deepseek) — it never holds or
// sees an API key. The key is attached server-side by api/deepseek.js.
//
// This is the single entry point the rest of the app should use for any
// DeepSeek call (adaptive intake, CSV import, translation, etc.). Do not call
// NVIDIA directly from the browser.
//
// Local dev: `npm run dev` runs scripts/dev.mjs, which serves this same route
// through a local shim - api/deepseek.js is a Vercel function, plain
// `vite dev` never executes /api/* on its own. Production: Vercel serves it
// directly. Either way this file just calls the relative URL below.

const PROXY_URL = import.meta.env.VITE_DEEPSEEK_PROXY_URL || "/api/deepseek"

export class DeepSeekError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = "DeepSeekError"
    this.cause = cause
  }
}

const RETRYABLE_MAX_ATTEMPTS = 3
const RETRYABLE_BASE_DELAY_MS = 1500

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The NVIDIA free-tier endpoint returns a transient "ResourceExhausted:
// Worker local total request limit reached" 503 quite often in practice
// (observed repeatedly in manual testing) - it clears up within a few
// seconds. Worth a couple of automatic retries rather than surfacing a
// scary error for what's usually just shared-capacity noise.
function isRetryable(status, detail) {
  return status === 503 || /ResourceExhausted/i.test(detail || "")
}

async function callOnce({ messages, maxTokens, temperature, model, thinking }) {
  let res
  try {
    res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, model, chat_template_kwargs: { thinking } }),
    })
  } catch (e) {
    throw new DeepSeekError("No se pudo contactar el asistente de IA (revisa tu conexion).", e)
  }
  if (!res.ok) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j.detail || j.error || ""
    } catch {}
    const err = new DeepSeekError("El asistente de IA no respondio correctamente" + (detail ? ": " + detail : "") + ".", { status: res.status, detail })
    err.status = res.status
    err.detail = detail
    throw err
  }
  const data = await res.json()
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!content) throw new DeepSeekError("El asistente de IA devolvio una respuesta vacia.", data)
  return content
}

// Returns the assistant message content (string). Throws on transport/HTTP
// failure so callers can decide how to degrade. `thinking` defaults off:
// structured-output callers (JSON extraction) want a fast, deterministic
// answer, not a reasoning trace competing for the token budget.
export async function deepseekChat({ messages, maxTokens = 1000, temperature = 0.2, model, thinking = false } = {}) {
  let lastErr
  for (let attempt = 1; attempt <= RETRYABLE_MAX_ATTEMPTS; attempt++) {
    try {
      return await callOnce({ messages, maxTokens, temperature, model, thinking })
    } catch (e) {
      lastErr = e
      const retryable = e instanceof DeepSeekError && isRetryable(e.status, e.detail)
      if (!retryable || attempt === RETRYABLE_MAX_ATTEMPTS) break
      await sleep(RETRYABLE_BASE_DELAY_MS * attempt)
    }
  }
  throw lastErr
}

// Convenience: ask for a JSON object back and parse it, tolerating ```json
// fences. Returns the parsed object, or `fallback` if anything goes wrong -
// use this for low-stakes callers (e.g. translation) that should degrade
// quietly. For anything where a silent failure would just confuse the user
// (CSV import, the "prenda desde 0" chat), use extractStructured() instead,
// which throws so the caller can show a real error.
export async function deepseekJSON({ messages, maxTokens = 1000, temperature = 0.1, model } = {}, fallback = null) {
  try {
    const raw = await deepseekChat({ messages, maxTokens, temperature, model })
    return JSON.parse(raw.replace(/```json|```/g, "").trim())
  } catch {
    return fallback
  }
}

/**
 * One-shot structured extraction: send free-form content (a CSV's raw text,
 * for example) plus instructions describing the target JSON shape, get back
 * a parsed object. No conversation history, no silent fallback - throws
 * DeepSeekError on any failure so the UI can surface it.
 */
export async function extractStructured({ instructions, content, maxTokens = 1500 }) {
  const raw = await deepseekChat({
    messages: [
      {
        role: "user",
        content: instructions + "\n\nDevolve SOLO un objeto JSON valido, sin markdown ni texto adicional.\n\n" + content,
      },
    ],
    maxTokens,
    temperature: 0.1,
  })
  const cleaned = raw.replace(/```json|```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    throw new DeepSeekError("El asistente de IA no devolvio JSON valido.", { raw })
  }
}
