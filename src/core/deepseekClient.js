// Client-side helper. Calls OUR OWN proxy (/api/deepseek) — it never holds or
// sees an API key. The key is attached server-side by api/deepseek.js.
//
// This is the single entry point the rest of the app should use for any
// DeepSeek call (adaptive intake, translation, etc.). Do not call NVIDIA
// directly from the browser.

const PROXY_URL = import.meta.env.VITE_DEEPSEEK_PROXY_URL || "/api/deepseek"

// Returns the assistant message content (string). Throws on transport/HTTP
// failure so callers can decide how to degrade.
export async function deepseekChat({ messages, maxTokens = 1000, temperature = 0.2, model } = {}) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, model }),
  })
  if (!res.ok) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j.detail || j.error || ""
    } catch {}
    throw new Error("deepseek proxy failed (" + res.status + ") " + detail)
  }
  const data = await res.json()
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ""
}

// Convenience: ask for a JSON object back and parse it, tolerating ```json fences.
// Returns the parsed object, or `fallback` if anything goes wrong.
export async function deepseekJSON({ messages, maxTokens = 1000, temperature = 0.1, model } = {}, fallback = null) {
  try {
    const raw = await deepseekChat({ messages, maxTokens, temperature, model })
    return JSON.parse(raw.replace(/```json|```/g, "").trim())
  } catch {
    return fallback
  }
}
