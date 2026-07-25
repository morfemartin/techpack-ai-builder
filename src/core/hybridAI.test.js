import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./deepseekClient.js", () => ({
  DeepSeekError: class DeepSeekError extends Error {},
  getLocalAIHealth: vi.fn(async () => ({ status: "ok", model: "qwen" })),
  getTextAIProvider: vi.fn(() => "nvidia"),
  requestAIOnce: vi.fn(),
  requestAIStreamOnce: vi.fn(),
}))

import { getLocalAIHealth, getTextAIProvider, requestAIOnce, requestAIStreamOnce } from "./deepseekClient.js"
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
    getTextAIProvider.mockReturnValue("nvidia")
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

// Regression: the local model joins late on purpose, but it used to inherit
// the SHARED deadline. For intake (qwenDelayMs 30s, budgetMs 45s) that left it
// 15s to answer a call that measurably takes 30-80s, so it could never finish
// - and when the hosted model was also down, BOTH failed and the user saw an
// error instead of a slower answer. Observed live as "El asistente de IA local
// tardo demasiado en responder".
describe("local model timeout window", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetHybridAIForTests()
    getLocalAIHealth.mockResolvedValue({ status: "ok", model: "qwen" })
    getTextAIProvider.mockReturnValue("nvidia")
  })

  it("gives the local model a full window measured from when it starts", async () => {
    let localTimeout = null
    requestAIOnce.mockImplementation(({ provider, signal, timeoutMs }) => {
      if (provider === "nvidia") return waitForAbort(signal)
      localTimeout = timeoutMs
      return Promise.resolve({ content: '{"ok":true}', provider, model: "qwen" })
    })

    // intake: local joins at 30s against a 45s shared budget
    const promise = runHybridAI({ task: "intake", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(30000)
    await promise

    // The remaining shared budget at that point is only ~15s - far too short.
    expect(localTimeout).toBeGreaterThan(15000)
    expect(localTimeout).toBeGreaterThanOrEqual(89000)
  })

  it("never shortens a shared budget that is already generous", async () => {
    let localTimeout = null
    requestAIOnce.mockImplementation(({ provider, signal, timeoutMs }) => {
      if (provider === "nvidia") return waitForAbort(signal)
      localTimeout = timeoutMs
      return Promise.resolve({ content: '{"ok":true}', provider, model: "qwen" })
    })

    // outline: 50s budget, local joins at 32s
    const promise = runHybridAI({ task: "outline", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback" })
    await vi.advanceTimersByTimeAsync(32000)
    await promise
    expect(localTimeout).toBeGreaterThanOrEqual(89000)
  })

  // The "local" provider used to always mean Qwen - studio-ai.mjs's bridge can
  // now run a paid hosted model (Mistral) instead. Naming the wrong one in the
  // status message is worse than saying nothing, so the label must be derived
  // from the model name the upstream ACTUALLY returned, not assumed from the
  // provider slot. Verified live: NVIDIA down, local answered via Mistral, and
  // the status still said "Respondido por Qwen" before this fix.
  describe("onStatus names the model that actually answered", () => {
    function statusMessages() {
      const messages = []
      return { onStatus: (message) => messages.push(message), messages }
    }

    it("says Mistral when the local bridge's response names a mistral model", async () => {
      requestAIOnce.mockImplementation(({ provider, signal }) =>
        provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "mistral-small-2603" })
      )
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
      expect(messages.some((m) => m.startsWith("Respondido por Mistral"))).toBe(true)
      expect(messages.some((m) => m.includes("Qwen"))).toBe(false)
    })

    it("says Qwen when the local bridge's response names a qwen model", async () => {
      requestAIOnce.mockImplementation(({ provider, signal }) =>
        provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "mlx-community/Qwen3-8B-4bit" })
      )
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
      expect(messages.some((m) => m.startsWith("Respondido por Qwen"))).toBe(true)
    })

    it("falls back to a neutral 'Studio AI' label for an unrecognized local model, never guessing", async () => {
      requestAIOnce.mockImplementation(({ provider, signal }) =>
        provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "some-other-model" })
      )
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
      expect(messages.some((m) => m.startsWith("Respondido por Studio AI"))).toBe(true)
    })

    it("never names a specific local model before it has actually answered", async () => {
      // The pre-join "trying the local model" message fires BEFORE the result
      // (and its model name) is known - it must stay provider-neutral instead
      // of naming Qwen/Mistral speculatively.
      requestAIOnce.mockImplementation(({ provider, signal }) =>
        provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "mistral-small-2603" })
      )
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
      const preJoinMessages = messages.filter((m) => !m.startsWith("Respondido por"))
      expect(preJoinMessages.every((m) => !/qwen|mistral/i.test(m))).toBe(true)
    })
  })

  // Observed live: intake's 30s qwenDelayMs left "Consultando DeepSeek…"
  // frozen on screen, unchanged, for the entire wait - a user watching that
  // has no way to tell a slow-but-normal delay from a hang.
  describe("heartbeat fills the silence between real status events", () => {
    function statusMessages() {
      const messages = []
      return { onStatus: (message) => messages.push(message), messages }
    }

    it("ticks periodically during a long wait instead of staying silent", async () => {
      requestAIOnce.mockImplementation(({ provider, signal }) =>
        provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "mistral-small-2603" })
      )
      const { onStatus, messages } = statusMessages()
      // intake: local joins at 30s - the heartbeat should tick several times
      // during that wait, on top of the initial "Consultando DeepSeek…".
      const promise = runHybridAI({ task: "intake", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(29999)
      const heartbeatTicks = messages.filter((m) => m.startsWith("Esperando respuesta de la IA…"))
      expect(heartbeatTicks.length).toBeGreaterThanOrEqual(4) // ~30s / 5s interval
      await vi.advanceTimersByTimeAsync(1)
      await promise
    })

    it("never overwrites the real 'trying local' message the instant it fires", async () => {
      requestAIOnce.mockImplementation(({ provider, signal }) =>
        provider === "nvidia" ? waitForAbort(signal) : Promise.resolve({ content: '{"ok":true}', provider, model: "qwen" })
      )
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "intake", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(30000)
      await promise
      const localJoinIndex = messages.indexOf("DeepSeek está tardando; probando el modelo local…")
      expect(localJoinIndex).toBeGreaterThanOrEqual(0)
      // The message immediately after the real "trying local" event must not
      // be a heartbeat tick reasserting itself in the very same instant.
      expect(messages[localJoinIndex + 1]).not.toBe("Esperando respuesta de la IA… " + Math.round(30000 / 1000) + " s")
    })

    it("stops ticking once the operation has settled", async () => {
      requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: '{"ok":true}', provider, model: provider }))
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "x" }], validator: (v) => v.includes("ok"), fallback: "fallback", onStatus })
      await promise
      const countAfterSettle = messages.length
      await vi.advanceTimersByTimeAsync(60000)
      expect(messages.length).toBe(countAfterSettle)
    })

    it("announces the circuit-open skip instead of silently omitting NVIDIA", async () => {
      requestAIOnce.mockImplementation(({ provider }) =>
        provider === "nvidia" ? Promise.reject(Object.assign(new Error("down"), { status: 500 })) : Promise.resolve({ content: "valid", provider, model: "qwen" })
      )
      // "explain"'s qwenDelayMs (3s) still runs under fake timers even though
      // NVIDIA rejects instantly - advance past it for each warm-up call.
      for (let i = 0; i < 4; i++) {
        const warmPromise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "warm-" + i }], validator: (v) => v === "valid", fallback: "fallback" })
        await vi.advanceTimersByTimeAsync(3000)
        await warmPromise
      }
      const { onStatus, messages } = statusMessages()
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "after-open" }], validator: (v) => v === "valid", fallback: "fallback", onStatus })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
      expect(messages.some((m) => /NVIDIA en pausa/i.test(m))).toBe(true)
    })
  })

  // studio.html's whole point is a Mistral-only, no-cloud-dependency build -
  // no caller passed an explicit `providers` list, so every text task was
  // silently still racing NVIDIA too whenever a valid NVIDIA_API_KEY happened
  // to be configured for local dev. Observed live: NVIDIA answering first
  // with a validator-rejecting response while Mistral (joining late via
  // qwenDelayMs) hadn't finished yet, producing a "both providers failed"
  // error in the build that exists specifically to not depend on NVIDIA.
  describe("studio build provider pinning", () => {
    it("never calls NVIDIA when getTextAIProvider() reports 'local' (studio.html) and no explicit providers list is given", async () => {
      getTextAIProvider.mockReturnValue("local")
      requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: "valid", provider, model: "mistral-small-2603" }))
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "hola" }], validator: (v) => v === "valid", fallback: "fallback" })
      await vi.advanceTimersByTimeAsync(3000)
      const result = await promise
      expect(result.provider).toBe("local")
      expect(requestAIOnce.mock.calls.some(([args]) => args.provider === "nvidia")).toBe(false)
    })

    it("still races NVIDIA + local on the public build (getTextAIProvider() 'nvidia') when no explicit providers list is given", async () => {
      getTextAIProvider.mockReturnValue("nvidia")
      requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: "valid", provider, model: provider === "nvidia" ? "deepseek" : "qwen" }))
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "hola" }], validator: (v) => v === "valid", fallback: "fallback" })
      await vi.advanceTimersByTimeAsync(3000)
      await promise
      expect(requestAIOnce.mock.calls.some(([args]) => args.provider === "nvidia")).toBe(true)
    })

    it("an explicit providers list still overrides getTextAIProvider() either way", async () => {
      getTextAIProvider.mockReturnValue("local")
      requestAIOnce.mockImplementation(({ provider }) => Promise.resolve({ content: "valid", provider, model: "deepseek" }))
      const promise = runHybridAI({ task: "explain", messages: [{ role: "user", content: "hola" }], validator: (v) => v === "valid", fallback: "fallback", providers: ["nvidia"] })
      await vi.advanceTimersByTimeAsync(3000)
      const result = await promise
      expect(result.provider).toBe("nvidia")
    })
  })
})
