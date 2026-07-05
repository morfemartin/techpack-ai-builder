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
//
// A `fetch()` that throws outright (network drop, DNS hiccup, a brief
// Vercel cold-start) is just as transient in practice - it has no
// `status`/`detail` at all, so it's flagged via `networkError` instead and
// retried the same way (observed live: a real "No se pudo contactar" that
// turned out to be a one-off blip, not a real outage).
function isRetryable(err) {
  return !!err.networkError || err.status === 503 || /ResourceExhausted/i.test(err.detail || "")
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
    const err = new DeepSeekError("No se pudo contactar el asistente de IA (revisa tu conexion).", e)
    err.networkError = true
    throw err
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
      const retryable = e instanceof DeepSeekError && isRetryable(e)
      if (!retryable || attempt === RETRYABLE_MAX_ATTEMPTS) break
      await sleep(RETRYABLE_BASE_DELAY_MS * attempt)
    }
  }
  throw lastErr
}

async function openStream({ messages, maxTokens, temperature, model, thinking }) {
  let res
  try {
    res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, model, stream: true, chat_template_kwargs: { thinking } }),
    })
  } catch (e) {
    const err = new DeepSeekError("No se pudo contactar el asistente de IA (revisa tu conexion).", e)
    err.networkError = true
    throw err
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
  return res
}

// Streaming call path (F3.1b) - a separate flow from deepseekChat on purpose:
// retrying mid-stream doesn't mean the same thing as retrying a failed
// request. It DOES reuse the same retry/backoff for the "open the stream"
// phase only (a 503 before any bytes flow is just as transient here as it is
// for the non-streaming path) - once the stream is open, there's no retry: a
// failure while chunks are already flowing is rare, and restarting a long
// generation from scratch isn't worth it (accepted simplification).
//
// onEvent(partial) fires on every SSE delta that carries content:
//   { contentSoFar: string, deltaText: string, tokensSoFar: number }
// tokensSoFar counts SSE EVENTS, not real tokens - NVIDIA batches several
// tokens per event, so this is only ever an estimate for a progress bar.
//
// Resolves with the final assembled content string once the stream ends
// cleanly - either "[DONE]" arrives, or an event carries
// `finish_reason: "length"` (the model hit maxTokens; content up to that
// point is still real and worth handing back for a JSON-repair attempt).
// Throws DeepSeekError if the retries opening the stream are exhausted, on a
// network failure, or if the stream ends with no recognized finish signal
// and no content at all (a dropped connection before anything came through).
export async function deepseekChatStream({ messages, maxTokens = 1000, temperature = 0.2, model, thinking = false, onEvent } = {}) {
  let res
  for (let attempt = 1; attempt <= RETRYABLE_MAX_ATTEMPTS; attempt++) {
    try {
      res = await openStream({ messages, maxTokens, temperature, model, thinking })
      break
    } catch (e) {
      const retryable = e instanceof DeepSeekError && isRetryable(e)
      if (!retryable || attempt === RETRYABLE_MAX_ATTEMPTS) throw e
      await sleep(RETRYABLE_BASE_DELAY_MS * attempt)
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  let eventCount = 0
  let finished = false
  let finishReason = null

  while (!finished) {
    const { done: readerDone, value } = await reader.read()
    if (readerDone) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() // last piece may be incomplete - keep for the next read

    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith("data:")) continue
      const dataStr = line.slice(5).trim()
      if (dataStr === "[DONE]") {
        finished = true
        break
      }
      let evt
      try {
        evt = JSON.parse(dataStr)
      } catch {
        continue // skip a malformed/partial event rather than crashing the stream
      }
      const choice = evt && evt.choices && evt.choices[0]
      const deltaText = (choice && choice.delta && choice.delta.content) || ""
      if (deltaText) {
        content += deltaText
        eventCount++
        if (onEvent) onEvent({ contentSoFar: content, deltaText, tokensSoFar: eventCount })
      }
      // OpenAI-compatible streams carry the terminal reason on the last chunk:
      // "stop" = clean end (some providers omit the "[DONE]" sentinel, so trust
      // this too), "length" = the model hit max_tokens (JSON is truncated but
      // usually near-complete). Either way the generation is over.
      if (choice && choice.finish_reason) {
        finishReason = choice.finish_reason
        if (finishReason === "stop") finished = true
        break
      }
    }
  }

  // Any accumulated content is worth returning even when the stream ended on a
  // "length" cap or dropped mid-response: the caller parses with a truncated-JSON
  // salvage pass (repairTruncatedJSON), so a nearly-complete answer is recovered
  // instead of thrown away. Only a genuinely empty result is an error - and the
  // message distinguishes a clean-but-empty completion from a real cutoff.
  if (!content) {
    const cleanEnd = finished || finishReason === "stop"
    throw new DeepSeekError(
      cleanEnd
        ? "El asistente de IA devolvio una respuesta vacia."
        : "La respuesta del asistente de IA se corto antes de terminar.",
      { streamed: true, finishReason }
    )
  }
  return content
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
