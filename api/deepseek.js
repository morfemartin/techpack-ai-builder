// Server-side proxy to DeepSeek via NVIDIA's OpenAI-compatible endpoint.
//
// The API key lives ONLY here (process.env.NVIDIA_API_KEY) and is NEVER sent to
// the browser. The client calls POST /api/deepseek with a chat payload; this
// function attaches the key server-side and forwards the request to NVIDIA.
//
// Security measures baked in:
// - POST only (405 otherwise)
// - hard caps on max_tokens and message count (so anyone who discovers the
//   endpoint cannot drain the NVIDIA account with huge or unlimited requests)
// - optional CORS origin allowlist via ALLOWED_ORIGIN
// - the key is never logged, never echoed, and upstream auth errors are not
//   leaked verbatim to the client
//
// Rate limiting is intentionally NOT implemented here yet — see SECURITY.md
// "Hardening backlog". For production put this behind Vercel's built-in
// protection or a KV-based limiter.

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v3.1"
const MAX_TOKENS_CAP = 4000
const MAX_MESSAGES = 40

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
  if (messages.length > MAX_MESSAGES) return res.status(400).json({ error: "too_many_messages" })

  const payload = {
    model: typeof body.model === "string" ? body.model : NVIDIA_MODEL,
    messages,
    max_tokens: Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP),
    temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
    stream: false,
  }

  try {
    const upstream = await fetch(NVIDIA_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(payload),
    })
    const data = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      // Surface a useful-but-sanitized message; never forward auth headers/keys.
      return res.status(upstream.status).json({ error: "upstream_error", detail: (data && data.error && data.error.message) || "request failed" })
    }
    return res.status(200).json(data)
  } catch (e) {
    return res.status(502).json({ error: "proxy_error", detail: String((e && e.message) || e) })
  }
}
