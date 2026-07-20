import { afterEach, describe, expect, it, vi } from "vitest"

function makeReqRes(body) {
  const req = { method: "POST", body }
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    setHeader(key, value) {
      this.headers[key] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(value) {
      this.setHeader("Content-Type", "application/json")
      this.headersSent = true
      this.body = JSON.stringify(value)
      return this
    },
    end(value = "") {
      this.headersSent = true
      this.body += value
      return this
    },
    write(value = "") {
      this.headersSent = true
      this.body += value
      return true
    },
  }
  return { req, res }
}

async function loadHandler(env = {}) {
  vi.resetModules()
  process.env.NVIDIA_API_KEY = "test-key"
  process.env.NVIDIA_BASE_URL = "https://example.test/v1"
  process.env.NVIDIA_UPSTREAM_TIMEOUT_MS = "5"
  process.env.NVIDIA_UPSTREAM_STREAM_STALL_TIMEOUT_MS = "5"
  Object.assign(process.env, env)
  const mod = await import("./deepseek.js?" + Date.now())
  return mod.default
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_BASE_URL
  delete process.env.NVIDIA_MODEL
  delete process.env.NVIDIA_FALLBACK_MODEL
  delete process.env.NVIDIA_UPSTREAM_TIMEOUT_MS
  delete process.env.NVIDIA_UPSTREAM_STREAM_STALL_TIMEOUT_MS
})

describe("api/deepseek proxy", () => {
  it("returns a 504 when NVIDIA does not answer before the upstream timeout", async () => {
    const handler = await loadHandler()
    global.fetch = vi.fn((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted")
          err.name = "AbortError"
          reject(err)
        })
      })
    })

    const { req, res } = makeReqRes({
      messages: [{ role: "user", content: "Responde solo OK" }],
      max_tokens: 10,
    })

    await handler(req, res)

    expect(res.statusCode).toBe(504)
    expect(JSON.parse(res.body)).toEqual({
      error: "upstream_timeout",
      detail: "NVIDIA no respondio antes del timeout del proxy",
    })
  })

  it("still forwards a normal non-streaming completion response", async () => {
    const handler = await loadHandler({ NVIDIA_MODEL: "deepseek-ai/deepseek-v4-flash" })
    global.fetch = vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body).model).toBe("deepseek-ai/deepseek-v4-flash")
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      }
    })

    const { req, res } = makeReqRes({
      messages: [{ role: "user", content: "Responde solo OK" }],
      max_tokens: 10,
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).choices[0].message.content).toBe("OK")
  })

  it("falls back to the configured model when the primary model is capacity-exhausted", async () => {
    const handler = await loadHandler({
      NVIDIA_MODEL: "deepseek-ai/deepseek-v4-flash",
      NVIDIA_FALLBACK_MODEL: "meta/llama-3.1-70b-instruct",
    })
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: "ResourceExhausted: Worker local total request limit reached" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      })

    const { req, res } = makeReqRes({
      messages: [{ role: "user", content: "Responde solo OK" }],
      max_tokens: 10,
    })

    await handler(req, res)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe("deepseek-ai/deepseek-v4-flash")
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).model).toBe("meta/llama-3.1-70b-instruct")
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).choices[0].message.content).toBe("OK")
  })

  it("wraps a non-streaming fallback completion as SSE for streaming requests", async () => {
    const handler = await loadHandler({
      NVIDIA_MODEL: "deepseek-ai/deepseek-v4-flash",
      NVIDIA_FALLBACK_MODEL: "meta/llama-3.1-70b-instruct",
    })
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: "ResourceExhausted: Worker local total request limit reached" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{\"garmentType\":\"hoodie\",\"fields\":[]}" } }] }),
      })

    const { req, res } = makeReqRes({
      stream: true,
      messages: [{ role: "user", content: "Analiza hoodie" }],
      max_tokens: 100,
    })

    await handler(req, res)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).stream).toBe(true)
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).stream).toBe(false)
    expect(res.statusCode).toBe(200)
    expect(res.headers["Content-Type"]).toBe("text/event-stream")
    expect(res.body).toContain('data: {"choices":[{"delta":{"content":"')
    const firstEvent = JSON.parse(res.body.split("\n\n")[0].slice("data: ".length))
    expect(firstEvent.choices[0].delta.content).toContain('"garmentType":"hoodie"')
    expect(res.body).toContain("data: [DONE]")
  })
})
