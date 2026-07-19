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

function sendJSON(res, status, value) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(value))
}

function allowedHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host || "")
}

export function isAllowedOrigin(origin, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  return !origin || allowedOrigins.includes(origin)
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

async function readJSON(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large")
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
} = {}) {
  return createServer(async (req, res) => {
    if (!allowedHost(req.headers.host)) return sendJSON(res, 403, { error: "host_forbidden" })
    if (!setCors(req, res, allowedOrigins)) return sendJSON(res, 403, { error: "origin_forbidden" })
    if (req.method === "OPTIONS") return sendJSON(res, 204, {})

    const url = new URL(req.url, "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/health") {
      const ready = readiness.status === "ready"
      return sendJSON(res, ready ? 200 : 503, { status: readiness.status || "starting", provider: "mlx", model, private: true })
    }

    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return sendJSON(res, 404, { error: "not_found" })
    }

    try {
      const payload = sanitizeCompletionPayload(await readJSON(req), model)
      const upstream = await fetchImpl(upstreamBaseURL + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
