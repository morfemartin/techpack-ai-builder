import { describe, expect, it } from "vitest"
import { createStudioBridge, isAllowedOrigin, sanitizeCompletionPayload } from "./studioBridge.mjs"

describe("studio AI bridge security", () => {
  it("allows only configured browser origins", () => {
    expect(isAllowedOrigin("https://morfemartin.github.io")).toBe(true)
    expect(isAllowedOrigin("https://attacker.example")).toBe(false)
  })

  it("trusts any local dev port, not just the pinned :3000 default", () => {
    // Vite auto-increments past :3000 whenever it's already taken, silently
    // breaking this bridge for the browser (Origin no longer in the strict
    // allowlist) even though it only ever binds to 127.0.0.1 - not a real
    // cross-origin risk, just a dev-port mismatch that looked like "Qwen is
    // unreachable" from the app's side.
    expect(isAllowedOrigin("http://localhost:3001")).toBe(true)
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true)
    expect(isAllowedOrigin("https://attacker.example")).toBe(false)
  })

  it("forces the configured local model and caps tokens", () => {
    const payload = sanitizeCompletionPayload({
      model: "attacker/model",
      max_tokens: 999999,
      messages: [{ role: "user", content: "plan" }],
    }, "studio/qwen")
    expect(payload.model).toBe("studio/qwen")
    expect(payload.max_tokens).toBe(4096)
  })

  it("rejects image content so vision cannot leak into the local text route", () => {
    expect(() => sanitizeCompletionPayload({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,x" } }] }],
    })).toThrow("message_invalid")
  })

  it("reports ready only after the launcher completed a real warmup", async () => {
    const bridge = createStudioBridge({ readiness: { status: "ready" } })
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
    try {
      const { port } = bridge.address()
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: "http://localhost:3000" } })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: "ready", private: true })
    } finally {
      await new Promise((resolve) => bridge.close(resolve))
    }
  })
})
