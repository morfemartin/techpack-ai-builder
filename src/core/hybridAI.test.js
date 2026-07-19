import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  DeepSeekError: class DeepSeekError extends Error {},
  getLocalAIHealth: vi.fn(async () => ({ status: "ok", model: "qwen" })),
  requestAIOnce: vi.fn(),
}))

import { getLocalAIHealth, requestAIOnce } from "./deepseekClient.js"
import { resetHybridAIForTests, runHybridAI } from "./hybridAI.js"

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

  it("opens the NVIDIA circuit after two failures and goes directly to Qwen", async () => {
    requestAIOnce.mockImplementation(({ provider }) => provider === "nvidia" ? Promise.reject(Object.assign(new Error("down"), { status: 500 })) : Promise.resolve({ content: "valid", provider, model: "qwen" }))
    for (let i = 0; i < 2; i++) {
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: String(i) }], validator: () => true, fallback: "fallback" })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
    }
    requestAIOnce.mockClear()
    const third = runHybridAI({ task: "explain", messages: [{ role: "user", content: "third" }], validator: () => true, fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(0)
    expect((await third).provider).toBe("local")
    expect(requestAIOnce.mock.calls.every(([args]) => args.provider === "local")).toBe(true)
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
})
