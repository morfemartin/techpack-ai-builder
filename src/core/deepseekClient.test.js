import { describe, it, expect, vi, beforeEach } from "vitest"
import { deepseekChat, deepseekJSON, extractStructured, DeepSeekError } from "./deepseekClient.js"

function mockFetchOnce(body, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
}

describe("deepseekClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("deepseekChat returns the assistant message content on success", async () => {
    mockFetchOnce({ choices: [{ message: { content: "hola" } }] })
    const result = await deepseekChat({ messages: [{ role: "user", content: "hi" }] })
    expect(result).toBe("hola")
  })

  it("deepseekChat sends thinking:false by default", async () => {
    mockFetchOnce({ choices: [{ message: { content: "ok" } }] })
    await deepseekChat({ messages: [] })
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(sentBody.chat_template_kwargs).toEqual({ thinking: false })
  })

  it("deepseekChat throws DeepSeekError on a non-retryable non-ok response", async () => {
    mockFetchOnce({ error: "bad_request" }, false, 400)
    await expect(deepseekChat({ messages: [] })).rejects.toBeInstanceOf(DeepSeekError)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("deepseekChat retries on the NVIDIA free-tier ResourceExhausted 503, then succeeds", async () => {
    vi.useFakeTimers()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "upstream_error", detail: "ResourceExhausted: Worker local total request limit reached (33/32)" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) })

    const promise = deepseekChat({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("ok")
    expect(global.fetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("deepseekChat gives up after exhausting retries on a persistent 503", async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "upstream_error", detail: "ResourceExhausted" }) })
    const promise = deepseekChat({ messages: [] })
    const assertion = expect(promise).rejects.toBeInstanceOf(DeepSeekError)
    await vi.runAllTimersAsync()
    await assertion
    expect(global.fetch).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it("deepseekChat retries a one-off network failure (fetch() throwing outright), then succeeds", async () => {
    vi.useFakeTimers()
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) })

    const promise = deepseekChat({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("ok")
    expect(global.fetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("deepseekChat throws DeepSeekError after exhausting retries on a persistent network failure", async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    const promise = deepseekChat({ messages: [] })
    const assertion = expect(promise).rejects.toBeInstanceOf(DeepSeekError)
    await vi.runAllTimersAsync()
    await assertion
    expect(global.fetch).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it("deepseekChat throws DeepSeekError when the response has no content", async () => {
    mockFetchOnce({ choices: [{ message: {} }] })
    await expect(deepseekChat({ messages: [] })).rejects.toBeInstanceOf(DeepSeekError)
  })

  it("deepseekJSON parses a fenced JSON reply", async () => {
    mockFetchOnce({ choices: [{ message: { content: "```json\n{\"a\":1}\n```" } }] })
    const result = await deepseekJSON({ messages: [] })
    expect(result).toEqual({ a: 1 })
  })

  it("deepseekJSON returns the fallback instead of throwing on failure", async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockRejectedValue(new Error("boom"))
    const promise = deepseekJSON({ messages: [] }, { safe: true })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toEqual({ safe: true })
    vi.useRealTimers()
  })

  it("extractStructured returns the parsed object on success", async () => {
    mockFetchOnce({ choices: [{ message: { content: '{"parts":[{"id":1,"val":"x"}]}' } }] })
    const result = await extractStructured({ instructions: "extrae piezas", content: "csv text here" })
    expect(result).toEqual({ parts: [{ id: 1, val: "x" }] })
  })

  it("extractStructured throws DeepSeekError (not a silent fallback) on invalid JSON", async () => {
    mockFetchOnce({ choices: [{ message: { content: "esto no es json" } }] })
    await expect(extractStructured({ instructions: "x", content: "y" })).rejects.toBeInstanceOf(DeepSeekError)
  })
})
