import { createServer } from "node:http"

export const DEFAULT_STUDIO_MODEL = "mlx-community/Qwen3-8B-4bit"
export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://morfemartin.github.io",
]

const MAX_BODY_BYTES = 1024 * 1024
const MAX_MESSAGES = 64
const MAX_MESSAGE_CHARS = 120000
const MAX_TOKENS = 4096

// A base64 Wilcom worksheet PDF is comfortably larger than a chat message -
// its own budget, separate from MAX_BODY_BYTES, so this stays generous
// without loosening the text-only chat surface those caps exist to bound.
const MAX_OCR_BODY_BYTES = 8 * 1024 * 1024

function sendJSON(res, status, value) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(value))
}

function allowedHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host || "")
}

// Vite's dev port drifts (auto-increments to 3001+ whenever 3000 is already
// taken by another process) - a STRICT allowlist pinned to :3000 silently
// rejects the browser's Origin the moment that happens, and the failure is
// invisible to the user: qwenAvailable() just reports the local model as
// unreachable, so the app looks like it's ignoring a running, healthy Qwen
// bridge. allowedHost() below already trusts ANY port on localhost/127.0.0.1/
// [::1] for the request's Host header - the Origin check should trust the
// same local ports for the same reason (this bridge only ever binds to
// 127.0.0.1, so a local origin cannot be spoofed from outside the machine).
function isLocalOrigin(origin) {
  try {
    const url = new URL(origin)
    return (url.protocol === "http:" || url.protocol === "https:") && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)
  } catch {
    return false
  }
}

export function isAllowedOrigin(origin, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  return !origin || allowedOrigins.includes(origin) || isLocalOrigin(origin)
}

function setCors(req, res, allowedOrigins) {
  const origin = req.headers.origin
  if (!isAllowedOrigin(origin, allowedOrigins)) return false
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin)
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true")
  }
  return true
}

async function readJSON(req, maxBytes = MAX_BODY_BYTES) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error("body_too_large")
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new Error("invalid_json")
  }
}

function textContentOnly(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return null
  let text = ""
  for (const item of content) {
    if (!item || item.type !== "text" || typeof item.text !== "string") return null
    text += item.text
  }
  return text
}

export function sanitizeCompletionPayload(body, model = DEFAULT_STUDIO_MODEL) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    throw new Error("messages_invalid")
  }
  const messages = body.messages.map((message) => {
    const role = message && message.role
    const content = textContentOnly(message && message.content)
    if (!["system", "user", "assistant"].includes(role) || content === null || content.length > MAX_MESSAGE_CHARS) {
      throw new Error("message_invalid")
    }
    return { role, content }
  })
  return {
    model,
    messages,
    max_tokens: Math.min(Math.max(Number(body.max_tokens) || 1000, 1), MAX_TOKENS),
    temperature: Math.min(Math.max(Number(body.temperature) || 0, 0), 1),
    stream: !!body.stream,
  }
}

// Base64 only (no "data:application/pdf;base64," prefix - the bridge adds
// that itself when it builds the upstream request, so the client never has
// to know Mistral's exact document_url shape). A loose but real shape check:
// base64 is only [A-Za-z0-9+/=], and a real PDF is never a tiny string.
function sanitizeOcrPayload(body) {
  const document = body && body.document
  if (typeof document !== "string" || document.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(document)) {
    throw new Error("document_invalid")
  }
  return { document }
}

// Mistral's OCR response nests text under pages[].markdown - joined into one
// plain-text blob for the caller (GarmentChat's PDF-extraction flow feeds
// this straight into the existing chat-based extractStructured(), the same
// path csvImport.js already uses, rather than this bridge having to also
// understand Mistral's structured-annotation JSON shape).
function extractOcrText(data) {
  const pages = (data && Array.isArray(data.pages)) ? data.pages : []
  return pages.map((p) => (p && typeof p.markdown === "string" ? p.markdown : "")).filter(Boolean).join("\n\n")
}

async function pipeUpstream(upstream, res) {
  res.statusCode = upstream.status
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  if (!upstream.body) return res.end()
  const reader = upstream.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}

export function createStudioBridge({
  upstreamBaseURL = "http://127.0.0.1:11436/v1",
  model = DEFAULT_STUDIO_MODEL,
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  fetchImpl = fetch,
  readiness = { status: "starting" },
  // Present only when the upstream is a real hosted API (Mistral) rather
  // than the local MLX server - forwarded as a standard OpenAI-shaped
  // Authorization header. Never logged, never echoed back to the browser:
  // the browser only ever talks to THIS bridge, on 127.0.0.1, exactly like
  // api/deepseek.js is the sole custodian of the NVIDIA key server-side.
  apiKey = "",
  // Reported on /health so the UI can show which upstream is actually
  // answering ("Mistral" vs "Qwen") instead of a hardcoded label.
  provider = "mlx",
} = {}) {
  return createServer(async (req, res) => {
    if (!allowedHost(req.headers.host)) return sendJSON(res, 403, { error: "host_forbidden" })
    if (!setCors(req, res, allowedOrigins)) return sendJSON(res, 403, { error: "origin_forbidden" })
    if (req.method === "OPTIONS") return sendJSON(res, 204, {})

    const url = new URL(req.url, "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/health") {
      const ready = readiness.status === "ready"
      return sendJSON(res, ready ? 200 : 503, { status: readiness.status || "starting", provider, model, private: true })
    }

    if (req.method === "POST" && url.pathname === "/v1/ocr") {
      // Only the hosted Mistral upstream can OCR a document at all - the
      // local MLX branch (a text-only Qwen build, see studio-ai.mjs) has no
      // document capability, so fail fast and honestly instead of forwarding
      // a request the upstream can only reject.
      if (provider !== "mistral") return sendJSON(res, 501, { error: "ocr_not_supported", detail: "OCR requires the Mistral-backed studio bridge" })
      try {
        const { document } = sanitizeOcrPayload(await readJSON(req, MAX_OCR_BODY_BYTES))
        const upstream = await fetchImpl(upstreamBaseURL + "/ocr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: "mistral-ocr-latest",
            document: { type: "document_url", document_url: "data:application/pdf;base64," + document },
          }),
          signal: AbortSignal.timeout(120000),
        })
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "")
          return sendJSON(res, 502, { error: "ocr_upstream_error", detail: detail.slice(0, 500) })
        }
        const data = await upstream.json()
        return sendJSON(res, 200, { text: extractOcrText(data) })
      } catch (error) {
        const detail = String((error && error.message) || error)
        if (detail === "body_too_large") return sendJSON(res, 413, { error: detail })
        if (/invalid|document/.test(detail)) return sendJSON(res, 400, { error: detail })
        return sendJSON(res, 502, { error: "ocr_error", detail: "OCR request failed" })
      }
    }

    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return sendJSON(res, 404, { error: "not_found" })
    }

    try {
      const payload = sanitizeCompletionPayload(await readJSON(req), model)
      const upstream = await fetchImpl(upstreamBaseURL + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180000),
      })
      return await pipeUpstream(upstream, res)
    } catch (error) {
      const detail = String((error && error.message) || error)
      if (detail === "body_too_large") return sendJSON(res, 413, { error: detail })
      if (/invalid|message/.test(detail)) return sendJSON(res, 400, { error: detail })
      return sendJSON(res, 502, { error: "local_model_error", detail: "Local model request failed" })
    }
  })
}
