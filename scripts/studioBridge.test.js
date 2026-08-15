import { describe, expect, it } from "vitest"
import { createStudioBridge, HOSTED_MAX_TOKENS, isAllowedOrigin, sanitizeCompletionPayload } from "./studioBridge.mjs"

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

  it("allows the hosted Mistral bridge to finish the 6400-token translation contract", () => {
    const payload = sanitizeCompletionPayload({
      max_tokens: 999999,
      messages: [{ role: "user", content: "translate the complete document" }],
    }, "mistral-small-2603", HOSTED_MAX_TOKENS)
    expect(payload.max_tokens).toBe(6400)
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
      expect(await response.json()).toMatchObject({ status: "ready", private: true, provider: "mlx" })
    } finally {
      await new Promise((resolve) => bridge.close(resolve))
    }
  })

  it("reports the configured provider (e.g. mistral) on /health instead of a hardcoded label", async () => {
    const bridge = createStudioBridge({ readiness: { status: "ready" }, provider: "mistral", model: "mistral-small-2603" })
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
    try {
      const { port } = bridge.address()
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: "http://localhost:3000" } })
      expect(await response.json()).toMatchObject({ provider: "mistral", model: "mistral-small-2603" })
    } finally {
      await new Promise((resolve) => bridge.close(resolve))
    }
  })

  it("forwards a hosted-API key as a standard Authorization header to the upstream", async () => {
    let capturedHeaders = null
    const fetchImpl = async (url, init) => {
      capturedHeaders = init.headers
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    }
    const bridge = createStudioBridge({ apiKey: "secret-mistral-key", fetchImpl })
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
    try {
      const { port } = bridge.address()
      await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hola" }] }),
      })
      expect(capturedHeaders.Authorization).toBe("Bearer secret-mistral-key")
    } finally {
      await new Promise((resolve) => bridge.close(resolve))
    }
  })

  it("never sends an Authorization header when no apiKey is configured (the local MLX path)", async () => {
    let capturedHeaders = null
    const fetchImpl = async (url, init) => {
      capturedHeaders = init.headers
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    }
    const bridge = createStudioBridge({ fetchImpl })
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
    try {
      const { port } = bridge.address()
      await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hola" }] }),
      })
      expect(capturedHeaders.Authorization).toBeUndefined()
    } finally {
      await new Promise((resolve) => bridge.close(resolve))
    }
  })

  describe("/v1/ocr - Wilcom PDF extraction", () => {
    const fakeBase64Pdf = "A".repeat(200) // shape-only check, not a real PDF

    it("rejects OCR entirely when the upstream is not Mistral - the local MLX text model has no document capability", async () => {
      const bridge = createStudioBridge({ provider: "mlx" })
      await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
      try {
        const { port } = bridge.address()
        const response = await fetch(`http://127.0.0.1:${port}/v1/ocr`, {
          method: "POST",
          headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ document: fakeBase64Pdf }),
        })
        expect(response.status).toBe(501)
        expect((await response.json()).error).toBe("ocr_not_supported")
      } finally {
        await new Promise((resolve) => bridge.close(resolve))
      }
    })

    it("builds Mistral's OCR request shape and returns the joined page text", async () => {
      let capturedBody = null
      let capturedUrl = null
      const fetchImpl = async (url, init) => {
        capturedUrl = url
        capturedBody = JSON.parse(init.body)
        return new Response(JSON.stringify({ pages: [{ markdown: "Stitches: 4800" }, { markdown: "Colors: 2" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      const bridge = createStudioBridge({ provider: "mistral", apiKey: "secret", upstreamBaseURL: "https://api.mistral.ai/v1", fetchImpl })
      await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
      try {
        const { port } = bridge.address()
        const response = await fetch(`http://127.0.0.1:${port}/v1/ocr`, {
          method: "POST",
          headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ document: fakeBase64Pdf }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ text: "Stitches: 4800\n\nColors: 2" })
        expect(capturedUrl).toBe("https://api.mistral.ai/v1/ocr")
        expect(capturedBody.model).toBe("mistral-ocr-latest")
        expect(capturedBody.document).toEqual({ type: "document_url", document_url: "data:application/pdf;base64," + fakeBase64Pdf })
      } finally {
        await new Promise((resolve) => bridge.close(resolve))
      }
    })

    it("never forwards a key-less request as Authorization, same discipline as the chat route", async () => {
      let capturedHeaders = null
      const fetchImpl = async (url, init) => {
        capturedHeaders = init.headers
        return new Response(JSON.stringify({ pages: [] }), { status: 200, headers: { "content-type": "application/json" } })
      }
      const bridge = createStudioBridge({ provider: "mistral", fetchImpl })
      await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
      try {
        const { port } = bridge.address()
        await fetch(`http://127.0.0.1:${port}/v1/ocr`, {
          method: "POST",
          headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ document: fakeBase64Pdf }),
        })
        expect(capturedHeaders.Authorization).toBeUndefined()
      } finally {
        await new Promise((resolve) => bridge.close(resolve))
      }
    })

    it("rejects a document that is missing, too short, or not base64-shaped", async () => {
      const bridge = createStudioBridge({ provider: "mistral", fetchImpl: async () => new Response("{}") })
      await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
      try {
        const { port } = bridge.address()
        for (const body of [{}, { document: "short" }, { document: "not-base64!! ".repeat(20) }]) {
          const response = await fetch(`http://127.0.0.1:${port}/v1/ocr`, {
            method: "POST",
            headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          expect(response.status).toBe(400)
        }
      } finally {
        await new Promise((resolve) => bridge.close(resolve))
      }
    })

    it("surfaces a clear error when the upstream itself rejects the document", async () => {
      const fetchImpl = async () => new Response("bad request from mistral", { status: 400 })
      const bridge = createStudioBridge({ provider: "mistral", fetchImpl })
      await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve))
      try {
        const { port } = bridge.address()
        const response = await fetch(`http://127.0.0.1:${port}/v1/ocr`, {
          method: "POST",
          headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ document: fakeBase64Pdf }),
        })
        expect(response.status).toBe(502)
        expect((await response.json()).error).toBe("ocr_upstream_error")
      } finally {
        await new Promise((resolve) => bridge.close(resolve))
      }
    })
  })
})
