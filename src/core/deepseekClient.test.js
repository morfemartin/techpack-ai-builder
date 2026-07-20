import { describe, it, expect, vi, beforeEach } from "vitest"
import { deepseekChat, deepseekChatStream, deepseekJSON, extractStructured, DeepSeekError } from "./deepseekClient.js"

function mockFetchOnce(body, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
}

// Builds a fake `Response`-like object whose `.body.getReader()` yields the
// given raw SSE text chunks (already-encoded strings, e.g. "data: {...}\n\n")
// one at a time, mirroring how a real fetch() streaming response behaves.
function mockStreamResponse(chunks, { ok = true, status = 200, errorBody } = {}) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok,
    status,
    json: async () => errorBody || {},
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) return { done: true, value: undefined }
          const value = encoder.encode(chunks[i])
          i++
          return { done: false, value }
        },
      }),
    },
  }
}

// Like mockStreamResponse, but once `chunks` runs out, the next read() call
// throws instead of signaling done:true - mirrors a connection that's cut
// off mid-stream (e.g. a serverless function's execution timeout) rather
// than one that closes cleanly.
function mockStreamResponseThatDrops(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) throw new TypeError("network error")
          const value = encoder.encode(chunks[i])
          i++
          return { done: false, value }
        },
      }),
    },
  }
}

function sseEvent(content, finishReason) {
  const delta = finishReason ? {} : { content, role: "assistant" }
  const choice = finishReason ? { delta, finish_reason: finishReason } : { delta }
  return "data: " + JSON.stringify({ choices: [choice] }) + "\n\n"
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

  it("deepseekChat omits model entirely when not given, so the server's own per-environment default wins", async () => {
    mockFetchOnce({ choices: [{ message: { content: "ok" } }] })
    await deepseekChat({ messages: [] })
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(sentBody).not.toHaveProperty("model")
  })

  it("deepseekChat preserves an explicit model override", async () => {
    mockFetchOnce({ choices: [{ message: { content: "ok" } }] })
    await deepseekChat({ messages: [], model: "custom-model" })
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(sentBody.model).toBe("custom-model")
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

  it("deepseekChat retries on a clean 500 'Failed to generate completions' (observed live), then succeeds", async () => {
    vi.useFakeTimers()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "upstream_error", detail: "Failed to generate completions" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) })

    const promise = deepseekChat({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("ok")
    expect(global.fetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  // Observed live via network inspection: api/deepseek.js's own upstream
  // timeout returns a 504 {error:"upstream_timeout"} when NVIDIA itself never
  // answers in time - distinct from OUR client-side FETCH_TIMEOUT_MS (that one
  // throws and hits wrapFetchFailure/networkError instead). This 504 was
  // falling straight through to the caller's fallback instead of getting a
  // second attempt.
  it("deepseekChat retries on a 504 from the proxy's own upstream timeout, then succeeds", async () => {
    vi.useFakeTimers()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({ error: "upstream_timeout", detail: "NVIDIA no respondio antes del timeout del proxy" }) })
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

  // Observed live: NVIDIA can hang indefinitely on a real chat completion -
  // no response, no error - while fetch() itself has no built-in timeout, so
  // without one the whole app just waits forever. These mock a fetch() that
  // NEVER settles unless its AbortSignal fires, proving FETCH_TIMEOUT_MS is
  // what breaks the hang, not luck.
  function mockHangingFetch() {
    return vi.fn().mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.")
          err.name = "AbortError"
          reject(err)
        })
      })
    })
  }

  it("deepseekChat times out a fetch() that never resolves, then retries and succeeds", async () => {
    vi.useFakeTimers()
    let callCount = 0
    global.fetch = vi.fn().mockImplementation((url, options) => {
      callCount++
      if (callCount === 1) return mockHangingFetch()(url, options)
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) })
    })
    const promise = deepseekChat({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("ok")
    expect(global.fetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("surfaces a distinct 'tardo demasiado' message when every retry also hangs", async () => {
    vi.useFakeTimers()
    global.fetch = mockHangingFetch()
    const promise = deepseekChat({ messages: [] })
    const assertion = expect(promise).rejects.toThrow(/tardo demasiado en responder/)
    await vi.runAllTimersAsync()
    await assertion
    expect(global.fetch).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
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

  it("deepseekChat wraps a res.json() parse failure as a retryable DeepSeekError instead of a raw exception", async () => {
    vi.useFakeTimers()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input")
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) })

    const promise = deepseekChat({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("ok")
    expect(global.fetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe("deepseekChatStream", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("assembles content from a single chunk and resolves on [DONE]", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponse([sseEvent("hola"), sseEvent(" mundo"), "data: [DONE]\n\n"]))
    const onEvent = vi.fn()
    const result = await deepseekChatStream({ messages: [], onEvent })
    expect(result).toBe("hola mundo")
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty("model")
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent.mock.calls[1][0]).toEqual({ contentSoFar: "hola mundo", deltaText: " mundo", tokensSoFar: 2 })
  })

  it("assembles content correctly even when a chunk boundary lands mid-event", async () => {
    const wholeEvent = sseEvent("partido en dos")
    const cut = Math.floor(wholeEvent.length / 2)
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponse([wholeEvent.slice(0, cut), wholeEvent.slice(cut), "data: [DONE]\n\n"]))
    const result = await deepseekChatStream({ messages: [] })
    expect(result).toBe("partido en dos")
  })

  it("rejects without calling onEvent when the response is non-2xx before any streaming", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponse([], { ok: false, status: 400, errorBody: { error: "bad_request" } }))
    const onEvent = vi.fn()
    await expect(deepseekChatStream({ messages: [], onEvent })).rejects.toBeInstanceOf(DeepSeekError)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it("falls back to a non-streaming call when the stream ends with no content", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockStreamResponse([]))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "rescatado" } }] }) })

    const result = await deepseekChatStream({ messages: [] })

    expect(result).toBe("rescatado")
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).stream).toBeUndefined()
  })

  // The core regression test for the observed-live bug: a stream that opens
  // fine but comes back empty (or the one-shot fallback also comes back
  // empty) used to only get ONE inline fallback attempt before throwing to
  // the UI. It must now get the SAME full-attempt retry treatment as
  // deepseekChat - a fresh stream open, fresh read, fresh fallback - not just
  // a retry of the connection-open phase.
  it("retries the whole attempt (stream + fallback) when both come back empty, succeeding on a later attempt", async () => {
    vi.useFakeTimers()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockStreamResponse([])) // attempt 1: stream empty
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: {} }] }) }) // attempt 1: fallback empty
      .mockResolvedValueOnce(mockStreamResponse([sseEvent("recuperado"), "data: [DONE]\n\n"])) // attempt 2: stream succeeds

    const promise = deepseekChatStream({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("recuperado")
    expect(global.fetch).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it("gives up after exhausting retries when the stream and fallback are persistently empty", async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body)
      if (body.stream) return Promise.resolve(mockStreamResponse([]))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ choices: [{ message: {} }] }) })
    })
    const promise = deepseekChatStream({ messages: [] })
    const assertion = expect(promise).rejects.toBeInstanceOf(DeepSeekError)
    await vi.runAllTimersAsync()
    await assertion
    expect(global.fetch).toHaveBeenCalledTimes(6) // 3 attempts x (stream open + non-streaming fallback)
    vi.useRealTimers()
  })

  it("returns the accumulated content when the stream ends without [DONE] (dropped mid-response)", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponse([sseEvent("incompleto")]))
    const result = await deepseekChatStream({ messages: [] })
    expect(result).toBe("incompleto")
  })

  it("returns the accumulated content when the model hits the token cap (finish_reason: length)", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponse([sseEvent("truncado a la mitad"), sseEvent(null, "length")]))
    const result = await deepseekChatStream({ messages: [] })
    expect(result).toBe("truncado a la mitad")
  })

  it("salvages accumulated content when reader.read() throws mid-stream instead of crashing the call", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponseThatDrops([sseEvent("parcial")]))
    const result = await deepseekChatStream({ messages: [] })
    expect(result).toBe("parcial")
  })

  // The connection can open fine and even deliver some content, then just
  // stop sending bytes with the stream never closing - a stall, distinct
  // from reader.read() throwing outright (tested above). Without its own
  // timeout, that read() would hang forever even though FETCH_TIMEOUT_MS
  // already got past opening the connection.
  it("salvages accumulated content when the stream stalls (no more bytes, never closes)", async () => {
    vi.useFakeTimers()
    let delivered = false
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: {
        getReader: () => ({
          read: () => {
            if (!delivered) {
              delivered = true
              return Promise.resolve({ done: false, value: new TextEncoder().encode(sseEvent("parcial")) })
            }
            return new Promise(() => {}) // never resolves - a genuine stall
          },
        }),
      },
    })
    const promise = deepseekChatStream({ messages: [] })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe("parcial")
    vi.useRealTimers()
  })

  it("skips a malformed SSE event without breaking the rest of the stream", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockStreamResponse([sseEvent("antes"), "data: {esto no es json valido\n\n", sseEvent(" despues"), "data: [DONE]\n\n"]))
    const result = await deepseekChatStream({ messages: [] })
    expect(result).toBe("antes despues")
  })
})
