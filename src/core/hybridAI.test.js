import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  DeepSeekError: class DeepSeekError extends Error {},
  getLocalAIHealth: vi.fn(async () => ({ status: "ok", model: "qwen" })),
  requestAIOnce: vi.fn(),
  requestAIStreamOnce: vi.fn(),
}))

import { getLocalAIHealth, requestAIOnce, requestAIStreamOnce } from "./deepseekClient.js"
import { resetHybridAIForTests, runHybridAI, runHybridAIStream } from "./hybridAI.js"

function waitForAbort(signal) {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }))
}

describe("runHybridAI", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetHybridAIForTests()
    getLocalAIHealth.mockResolvedValue({ status: "ok", model: "qwen" })
  })

  it("starts Qwen after the task grace and cancels slow DeepSeek", async () => {
    requestAIOnce.mockImplementation(({ provider, signal }) => provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "qwen" }))
    const resultPromise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "x" }], validator: (value) => value.includes("ok"), fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(2999)
    expect(requestAIOnce).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const result = await resultPromise
    expect(result.provider).toBe("local")
    expect(result.degraded).toBe(true)
  })

  it("rejects an invalid DeepSeek answer and accepts valid Qwen", async () => {
    requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: provider === "nvidia" ? "bad" : "valid", provider, model: provider }))
    const promise = runHybridAI({ task: "explain", messages: [], validator: (value) => value === "valid", fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(3000)
    expect((await promise).provider).toBe("local")
  })

  it("uses the deterministic contract when both answers are invalid", async () => {
    requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: "bad", provider, model: provider }))
    const promise = runHybridAI({ task: "explain", messages: [], validator: (value) => value === "contract", fallback: "contract" })
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise
    expect(result).toMatchObject({ provider: "contract", content: "contract", degraded: true })
  })

  it("deduplicates identical in-flight requests", async () => {
    requestAIOnce.mockResolvedValue({ content: "valid", provider: "nvidia", model: "deepseek" })
    const input = { task: "review", messages: [{ role: "user", content: "same" }], validator: () => true, fallback: "fallback" }
    const [a, b] = await Promise.all([runHybridAI(input), runHybridAI(input)])
    expect(requestAIOnce).toHaveBeenCalledOnce()
    expect(a).toEqual(b)
  })

  it("opens the NVIDIA circuit after four real failures and goes directly to Qwen", async () => {
    requestAIOnce.mockImplementation(({ provider }) => provider === "nvidia" ? Promise.reject(Object.assign(new Error("down"), { status: 500 })) : Promise.resolve({ content: "valid", provider, model: "qwen" }))
    for (let i = 0; i < 4; i++) {
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: String(i) }], validator: () => true, fallback: "fallback" })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
    }
    requestAIOnce.mockClear()
    const fifth = runHybridAI({ task: "explain", messages: [{ role: "user", content: "fifth" }], validator: () => true, fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(0)
    expect((await fifth).provider).toBe("local")
    expect(requestAIOnce.mock.calls.every(([args]) => args.provider === "local")).toBe(true)
  })

  it("opens the circuit on repeated 429 rate-limit responses, not just 5xx", async () => {
    // Observed live: once NVIDIA starts rate-limiting it returns 429 (not
    // 5xx) on every call. 429 is a real availability signal too - without
    // counting it, the circuit never opens and every task keeps re-trying a
    // provider that is consistently refusing instead of failing over fast.
    requestAIOnce.mockImplementation(({ provider }) => provider === "nvidia" ? Promise.reject(Object.assign(new Error("rate limited"), { status: 429 })) : Promise.resolve({ content: "valid", provider, model: "qwen" }))
    for (let i = 0; i < 4; i++) {
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: String(i) }], validator: () => true, fallback: "fallback" })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
    }
    requestAIOnce.mockClear()
    const fifth = runHybridAI({ task: "explain", messages: [{ role: "user", content: "fifth" }], validator: () => true, fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(0)
    expect((await fifth).provider).toBe("local")
    expect(requestAIOnce.mock.calls.every(([args]) => args.provider === "local")).toBe(true)
  })

  it("does NOT open the circuit when NVIDIA answers but fails the contract (validator reject)", async () => {
    // NVIDIA returns fast, invalid content; Qwen returns valid. Repeat many
    // times: the validator rejects NVIDIA each round, but that's a contract
    // miss, not an outage, so the circuit must stay closed and NVIDIA must keep
    // being raced (regression guard for the "casi inútil" bug).
    requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: provider === "nvidia" ? "bad" : "valid", provider, model: provider }))
    for (let i = 0; i < 6; i++) {
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "round" + i }], validator: (value) => value === "valid", fallback: "fallback" })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
    }
    requestAIOnce.mockClear()
    const next = runHybridAI({ task: "explain", messages: [{ role: "user", content: "after" }], validator: (value) => value === "valid", fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(3000)
    await next
    // NVIDIA is still being attempted - the circuit never opened.
    expect(requestAIOnce.mock.calls.some(([args]) => args.provider === "nvidia")).toBe(true)
  })

  it("reopens NVIDIA to the race after the circuit self-heals (20s)", async () => {
    let nvidiaShouldFail = true
    requestAIOnce.mockImplementation(({ provider }) => {
      if (provider === "nvidia") {
        if (nvidiaShouldFail) return Promise.reject(Object.assign(new Error("down"), { status: 503 }))
        return Promise.resolve({ content: "valid", provider, model: "deepseek" })
      }
      return Promise.resolve({ content: "valid", provider, model: "qwen" })
    })
    for (let i = 0; i < 4; i++) {
      const p = runHybridAI({ task: "explain", messages: [{ role: "user", content: "f" + i }], validator: () => true, fallback: "fallback", providers: ["nvidia"] })
      await vi.advanceTimersByTimeAsync(30000)
      await p.catch(() => {})
    }
    // circuit open now; heal it
    nvidiaShouldFail = false
    await vi.advanceTimersByTimeAsync(20001)
    requestAIOnce.mockClear()
    const healed = runHybridAI({ task: "explain", messages: [{ role: "user", content: "healed" }], validator: () => true, fallback: "fallback", providers: ["nvidia"] })
    await vi.advanceTimersByTimeAsync(3000)
    expect((await healed).provider).toBe("nvidia")
  })

  it("aborts a superseded operation so a late answer cannot replace current state", async () => {
    requestAIOnce.mockImplementation(({ messages, signal }) => messages[0].content === "old"
      ? waitForAbort(signal)
      : Promise.resolve({ content: "new", provider: "nvidia", model: "deepseek" }))
    const oldRun = runHybridAI({ task: "review", messages: [{ role: "user", content: "old" }], validator: () => true, fallback: "old fallback", providers: ["nvidia"] })
    const newRun = runHybridAI({ task: "review", messages: [{ role: "user", content: "new" }], validator: () => true, fallback: "new fallback", providers: ["nvidia"] })
    await expect(oldRun).rejects.toMatchObject({ name: "AbortError" })
    await expect(newRun).resolves.toMatchObject({ content: "new", provider: "nvidia" })
  })

  it("forwards real provider chunks before accepting the validated final answer", async () => {
    requestAIStreamOnce.mockImplementation(async ({ onEvent, provider }) => {
      onEvent({ contentSoFar: "{\"field\"", deltaText: "{\"field\"", tokensSoFar: 1 })
      onEvent({ contentSoFar: "{\"field\":true}", deltaText: ":true}", tokensSoFar: 2 })
      return { content: '{"field":true}', provider, model: "deepseek" }
    })
    const events = []
    const result = await runHybridAIStream({
      task: "explain",
      messages: [{ role: "user", content: "x" }],
      validator: (content) => content.includes("true"),
      fallback: "fallback",
      providers: ["nvidia"],
      onEvent: (event) => events.push(event),
    })
    expect(result).toMatchObject({ provider: "nvidia", content: '{"field":true}' })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ provider: "nvidia", tokensSoFar: 2 })
  })
})
