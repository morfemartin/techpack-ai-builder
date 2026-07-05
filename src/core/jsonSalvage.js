// Best-effort recovery for JSON that was cut off mid-generation - e.g. a
// streamed LLM response that hit its token cap (finish_reason: "length").
// Walks the string tracking open containers; wherever the input ends
// mid-construction, it abandons whatever was still being written at that
// point (a half-finished string, key, value, or nested object) and keeps
// everything that was already complete, closing every container still open
// at that point. Returns null when there's nothing usable to recover - e.g.
// the very first thing being built was itself unterminated.
export function repairTruncatedJSON(str) {
  if (typeof str !== "string") return null
  const trimmed = str.trim()
  if (!trimmed) return null

  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {}

  // Each open container gets a "safeEnd": the index up to which its content
  // is known-complete, updated whenever a child value finishes (a comma at
  // this depth, or a nested container closing). Whatever comes after a
  // frame's safeEnd is the pending, never-finished child - abandon it.
  const stack = []
  let inString = false
  let escaped = false

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === "{" || ch === "[") {
      stack.push({ open: ch, safeEnd: -1 })
    } else if (ch === "}" || ch === "]") {
      stack.pop()
      const parent = stack[stack.length - 1]
      if (parent) parent.safeEnd = i + 1
    } else if (ch === "," && stack.length > 0) {
      stack[stack.length - 1].safeEnd = i
    }
  }

  // Nothing was ever opened (or everything already closed) - not a
  // truncated-container case, just malformed JSON, out of scope here.
  if (stack.length === 0) return null

  for (let depth = stack.length - 1; depth >= 0; depth--) {
    if (stack[depth].safeEnd < 0) continue
    let candidate = trimmed.slice(0, stack[depth].safeEnd)
    for (let j = depth; j >= 0; j--) candidate += stack[j].open === "{" ? "}" : "]"
    try {
      JSON.parse(candidate)
      return candidate
    } catch {}
  }
  return null
}
