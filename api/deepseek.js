// Server-side proxy to DeepSeek via NVIDIA's OpenAI-compatible endpoint.
//
// The API key lives ONLY here (process.env.NVIDIA_API_KEY) and is NEVER sent to
// the browser. The client calls POST /api/deepseek with a chat payload; this
// function attaches the key server-side and forwards the request to NVIDIA.
//
// Security measures baked in:
// - POST only (405 otherwise)
// - hard cap on max_tokens (so anyone who discovers the endpoint cannot drain
//   the NVIDIA account with huge requests)
// - optional CORS origin allowlist via ALLOWED_ORIGIN
// - the key is never logged, never echoed, and upstream auth errors are not
//   leaked verbatim to the client
//
// Rate limiting is intentionally NOT implemented here yet — see SECURITY.md
// "Hardening backlog". For production put this behind Vercel's built-in
// protection or a KV-based limiter.
//
// TODO before public launch (see SECURITY.md "Hardening backlog"): the
// message-count cap (MAX_MESSAGES) was removed on purpose during development
// - GarmentChat.jsx resends the full conversation every turn, and long
// real conversations were hitting a 40-message cap mid-chat. Restore a cap
// (ideally paired with client-side history trimming/summarization instead of
// resending everything verbatim) before the public launch.

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v3.1"
const NVIDIA_FALLBACK_MODEL = process.env.NVIDIA_FALLBACK_MODEL || ""
const MAX_TOKENS_CAP = 4000
const UPSTREAM_TIMEOUT_MS = Number(process.env.NVIDIA_UPSTREAM_TIMEOUT_MS) || 28000
const UPSTREAM_STREAM_STALL_TIMEOUT_MS = Number(process.env.NVIDIA_UPSTREAM_STREAM_STALL_TIMEOUT_MS) || 30000

// NVIDIA doesn't use one consistent error shape: most rejections nest under
// {error: {message}} (OpenAI-style), but at least the vision models' vLLM
// backend replies with {message} at the top level instead (confirmed live:
// "At most 1 image(s) may be provided in one request..."). Check both so a
// real reason reaches the client instead of the generic "request failed".
function upstreamErrorDetail(data) {
  return (data && data.error && data.error.message) || (data && data.message) || "request failed"
}

function shouldTryFallback(model, status, data) {
  if (!NVIDIA_FALLBACK_MODEL || model === NVIDIA_FALLBACK_MODEL) return false
  const detail = upstreamErrorDetail(data)
  return status === 503 || /ResourceExhausted|Failed to generate completions/i.test(detail)
}

function isAbortError(e) {
  return e && (e.name === "AbortError" || /aborted/i.test(String(e.message || "")))
}

function timeoutErrorResponse(res) {
  return res.status(504).json({ error: "upstream_timeout", detail: "NVIDIA no respondio antes del timeout del proxy" })
}

async function readJSONOrEmpty(upstream) {
  try {
    return await upstream.json()
  } catch (e) {
    if (isAbortError(e)) throw e
    return {}
  }
}

function readWithTimeout(reader) {
  let timer
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("upstream_stream_stall_timeout")), UPSTREAM_STREAM_STALL_TIMEOUT_MS)
    }),
  ]).finally(() => clearTimeout(timer))
}

function contentFromCompletion(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
}

function writeSyntheticStream(res, content) {
  res.statusCode = 200
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.setHeader("Connection", "keep-alive")
  if (typeof res.flushHeaders === "function") res.flushHeaders()
  res.write("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }) + "\n\n")
  res.write("data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) + "\n\n")
  res.write("data: [DONE]\n\n")
  return res.end()
}

export default async function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed)
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  }
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" })

  const key = process.env.NVIDIA_API_KEY
  if (!key) return res.status(500).json({ error: "server_misconfigured", detail: "NVIDIA_API_KEY is not set" })

  let body
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}
  } catch {
    return res.status(400).json({ error: "invalid_json" })
  }

  const messages = Array.isArray(body.messages) ? body.messages : null
  if (!messages || messages.length === 0) return res.status(400).json({ error: "messages_required" })

  const wantsStream = !!body.stream
  let payload = {
    model: typeof body.model === "string" ? body.model : NVIDIA_MODEL,
    messages,
    max_tokens: Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP),
    temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
    stream: wantsStream,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let usedNonStreamingFallback = false

  try {
    let upstream = await fetch(NVIDIA_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    let upstreamErrorData = null

    if (!upstream.ok) {
      upstreamErrorData = await readJSONOrEmpty(upstream)
      if (shouldTryFallback(payload.model, upstream.status, upstreamErrorData)) {
        console.error("NVIDIA upstream error", upstream.status, JSON.stringify(upstreamErrorData), "retrying fallback model", NVIDIA_FALLBACK_MODEL)
        usedNonStreamingFallback = wantsStream
        payload = { ...payload, model: NVIDIA_FALLBACK_MODEL, stream: wantsStream ? false : payload.stream }
        upstream = await fetch(NVIDIA_BASE_URL + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        upstreamErrorData = null
      }
    }

    if (wantsStream && usedNonStreamingFallback) {
      const data = upstreamErrorData || (await readJSONOrEmpty(upstream))
      clearTimeout(timer)
      if (!upstream.ok) {
        console.error("NVIDIA upstream error", upstream.status, JSON.stringify(data))
        return res.status(upstream.status).json({ error: "upstream_error", detail: upstreamErrorDetail(data) })
      }
      const content = contentFromCompletion(data)
      if (!content) return res.status(502).json({ error: "proxy_error", detail: "fallback model returned empty content" })
      return writeSyntheticStream(res, content)
    }

    if (!wantsStream) {
      const data = upstreamErrorData || (await readJSONOrEmpty(upstream))
      clearTimeout(timer)
      if (!upstream.ok) {
        // Logged server-side only (Vercel function logs) - never sent to the
        // client, no key/auth header in it. Without this, an upstream
        // rejection with no data.error.message is a dead end to debug.
        console.error("NVIDIA upstream error", upstream.status, JSON.stringify(data))
        // Surface a useful-but-sanitized message; never forward auth headers/keys.
        return res.status(upstream.status).json({ error: "upstream_error", detail: upstreamErrorDetail(data) })
      }
      return res.status(200).json(data)
    }

    // Streaming path: NVIDIA already speaks OpenAI-compatible SSE
    // ("data: {...}\n\n", ending in "data: [DONE]\n\n") - pipe bytes through
    // unchanged rather than re-parsing/re-encoding each event. Status is
    // checked BEFORE touching the body, so a non-2xx here still returns a
    // normal JSON error the client's retry logic can handle exactly like the
    // non-streaming path; once bytes start flowing there's no going back to
    // a JSON error response (accepted simplification - see deepseekClient.js).
    if (!upstream.ok) {
      const data = upstreamErrorData || (await readJSONOrEmpty(upstream))
      clearTimeout(timer)
      console.error("NVIDIA upstream error", upstream.status, JSON.stringify(data))
      return res.status(upstream.status).json({ error: "upstream_error", detail: upstreamErrorDetail(data) })
    }
    clearTimeout(timer)

    res.statusCode = 200
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    if (typeof res.flushHeaders === "function") res.flushHeaders()

    const reader = upstream.body.getReader()
    while (true) {
      const { done, value } = await readWithTimeout(reader)
      if (done) break
      res.write(value)
    }
    return res.end()
  } catch (e) {
    clearTimeout(timer)
    if (isAbortError(e)) return timeoutErrorResponse(res)
    if (String((e && e.message) || e) === "upstream_stream_stall_timeout") {
      if (wantsStream && res.headersSent) return res.end()
      return timeoutErrorResponse(res)
    }
    if (wantsStream && res.headersSent) return res.end()
    return res.status(502).json({ error: "proxy_error", detail: String((e && e.message) || e) })
  }
}
