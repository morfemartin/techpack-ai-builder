// Thin wrappers around the Claude API used for two optional AI-assisted features:
// 1) extracting embroidery specs out of a Wilcom production-worksheet PDF
// 2) translating the tech pack's Spanish source fields into EN/ZH
//
// Both require the caller to provide their own Anthropic API key via
// VITE_ANTHROPIC_API_KEY (see .env.example) - the app works fully without it,
// these two features just no-op / fall back to the original values.

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

async function callClaude(body) {
  if (!API_KEY) return null
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return (data.content || []).find((b) => b.type === "text") || null
}

export async function extractEmbFromPDF(base64) {
  const prompt =
    "Extract all embroidery data from this Wilcom Production Worksheet PDF and return ONLY a JSON object with these exact keys (use empty string if not found): machine, stitches, colorChanges, stops, trims, fabric, stabTopping, stabBacking, appliques, w, h, area, maxStitch, minStitch, maxJump, totalThread, totalBobbin, stopSeq (array of {stop,color,stitches,code,name}). Return ONLY valid JSON no markdown."
  try {
    const raw = await callClaude({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }, { type: "text", text: prompt }] }],
    })
    if (!raw) return null
    return JSON.parse(raw.text.replace(/```json|```/g, "").trim())
  } catch (e) {
    return null
  }
}

export async function translateContent(hdr, parts, designs, targetLang) {
  const langName = targetLang === "EN" ? "English" : "Mandarin Chinese"
  const obj = {
    pname: hdr.pname,
    parts: parts.filter((p) => p.on).map((p) => p.val),
    designs: designs.map((d) => ({ name: d.name, posDetail: d.posDetail || "" })),
  }
  try {
    const raw = await callClaude({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: "Translate fashion apparel tech pack fields from Spanish to " + langName + ". Return ONLY valid JSON same keys. Do NOT translate brand names, codes, or numbers.\n\n" + JSON.stringify(obj) }],
    })
    if (!raw) return obj
    return JSON.parse(raw.text.replace(/```json|```/g, "").trim())
  } catch (e) {
    return obj
  }
}
