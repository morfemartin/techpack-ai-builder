import { DeepSeekError, getLocalAIHealth, getTextAIProvider, requestAIOnce, requestAIStreamOnce } from "./deepseekClient.js"
import { TASK_POLICIES } from "./hybridTasks.js"
export { HYBRID_TASKS, TASK_POLICIES } from "./hybridTasks.js"

const NVIDIA_MODEL = "deepseek-ai/deepseek-v4-pro"
// Circuit breaker tuned to only trip on REAL availability failures (5xx /
// network / timeout), never on a contract-violation (NVIDIA answered, the
// content just failed a strict task validator - see recordProviderOutcome).
// 4 genuine failures in a 60s window opens it for 20s (was 2 / 60s, which
// combined with miscounted contract-misses left NVIDIA starved and every
// task collapsing to the deterministic fallback - the "casi inútil" report).
const CIRCUIT_FAILURES = 4
const CIRCUIT_WINDOW_MS = 60000
const CIRCUIT_OPEN_MS = 20000
const HEALTH_TTL_MS = 30000
const TELEMETRY_KEY = "techpack.hybridAI.telemetry"
const inflight = new Map()
const activeOperations = new Map()
let operationSequence = 0
let nvidiaFailures = []
let circuitOpenedAt = 0
let qwenHealth = { checkedAt: 0, available: null }
let qwenTail = Promise.resolve()

function abortError(reason = "aborted") {
  const error = new DOMException(reason, "AbortError")
  return error
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError())
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    if (signal) signal.addEventListener("abort", abort, { once: true })
  })
}

function composeAbort(parent) {
  const controller = new AbortController()
  const abort = () => controller.abort(parent && parent.reason)
  if (parent) {
    if (parent.aborted) abort()
    else parent.addEventListener("abort", abort, { once: true })
  }
  return { controller, dispose: () => parent && parent.removeEventListener("abort", abort) }
}

// The local model gets its own window, measured from the moment it actually
// STARTS - not whatever is left of the shared budget.
//
// It joins late on purpose (qwenDelayMs, so the stronger hosted model gets
// first shot), and it inherited the global deadline. With intake's 30s delay
// against a 45s budget that left it 15s to answer a call that measurably
// takes 30-80s: it could never finish, so when the hosted model was also
// down BOTH failed and the user got an error instead of a slower answer.
//
// It is local: no cost, no rate limit, and by the time it runs it is the last
// thing standing between the user and a failure - so it is worth the wait.
const LOCAL_MIN_WINDOW_MS = 90000

function localDeadline(sharedDeadline) {
  return Math.max(sharedDeadline, Date.now() + LOCAL_MIN_WINDOW_MS)
}

// 502 is api/deepseek.js's own catch-all for its outbound fetch() to NVIDIA
// throwing outright (DNS hiccup, dropped connection) - the exact same kind of
// transient blip 503/504 already get retried for, just a different status
// because it's OUR proxy wrapping the failure rather than NVIDIA answering
// with one. Observed live: this was falling straight through to the caller
// with no second attempt while a 503/504 in the same situation would retry.
function retryableCapacityError(error) {
  return error && (error.status === 502 || error.status === 503 || error.status === 504)
}

function circuitIsOpen(now = Date.now()) {
  if (!circuitOpenedAt) return false
  if (now - circuitOpenedAt >= CIRCUIT_OPEN_MS) {
    circuitOpenedAt = 0
    nvidiaFailures = []
    return false
  }
  return true
}

function recordNvidiaFailure(now = Date.now()) {
  nvidiaFailures = nvidiaFailures.filter((time) => now - time < CIRCUIT_WINDOW_MS)
  nvidiaFailures.push(now)
  if (nvidiaFailures.length >= CIRCUIT_FAILURES) circuitOpenedAt = now
}

function recordNvidiaSuccess() {
  nvidiaFailures = []
  circuitOpenedAt = 0
}

// The "local" provider used to always mean Qwen - it can now be a paid
// hosted model (Mistral) instead, depending on what studio-ai.mjs's bridge
// is configured to run (see scripts/studio-ai.mjs). Hardcoding "Qwen" here
// would tell the user the wrong model answered - a status message that
// LIES is worse than one that says nothing. `result.model` is the actual
// model name the upstream API returned (studioBridge.mjs pipes it through
// unmodified), so this names whoever genuinely answered instead of
// assuming. Falls back to a neutral "Studio AI" label only if the model
// name doesn't match anything recognized - never guesses wrong.
export function localProviderLabel(model) {
  const name = String(model || "")
  if (/mistral/i.test(name)) return "Mistral"
  if (/qwen/i.test(name)) return "Qwen"
  return "Studio AI"
}

function providerLabel(result) {
  return result.provider === "local" ? localProviderLabel(result.model) : "DeepSeek"
}

// Fills the SILENCE between real status events, instead of leaving the UI
// frozen on whatever the last message said. Observed live: intake's 30s
// qwenDelayMs means "Consultando DeepSeek…" can sit on screen completely
// unchanged for up to half a minute while nothing visibly happens - a user
// watching that has no way to tell a slow-but-normal wait from a hang.
//
// Only ticks when nothing more specific has been said recently (tracked via
// `lastStatusAt`, bumped on every real onStatus call) - so it never
// overwrites "DeepSeek está tardando; probando el modelo local…" the moment
// that fires, it only shows up in the gaps around it. Always cleared in the
// caller's `finally` block, same discipline as the abort controllers.
const HEARTBEAT_INTERVAL_MS = 5000

function withHeartbeat(onStatus) {
  const noop = () => {}
  if (!onStatus) return { status: noop, stop: noop }
  const startedAt = Date.now()
  let lastStatusAt = startedAt
  const status = (message) => {
    lastStatusAt = Date.now()
    onStatus(message)
  }
  const timer = setInterval(() => {
    if (Date.now() - lastStatusAt < HEARTBEAT_INTERVAL_MS) return
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    status(`Esperando respuesta de la IA… ${seconds} s`)
  }, HEARTBEAT_INTERVAL_MS)
  return { status, stop: () => clearInterval(timer) }
}

async function qwenAvailable() {
  const now = Date.now()
  if (qwenHealth.available !== null && now - qwenHealth.checkedAt < HEALTH_TTL_MS) return qwenHealth.available
  try {
    const health = await getLocalAIHealth()
    qwenHealth = { checkedAt: now, available: !!(health && (health.ok || health.status === "ok" || health.model)) }
  } catch {
    qwenHealth = { checkedAt: now, available: false }
  }
  return qwenHealth.available
}

function enqueueQwen(work) {
  const run = qwenTail.then(work, work)
  qwenTail = run.catch(() => {})
  return run
}

function validateContent(validator, content) {
  if (!validator) return content
  const validated = validator(content)
  if (validated === false || validated == null) {
    // The provider DID answer - the content just didn't satisfy this task's
    // contract. Tagged so recordProviderOutcome never counts it as an NVIDIA
    // availability failure (a strict validator must not open the circuit).
    const error = new DeepSeekError("La respuesta no cumple el contrato de la tarea.")
    error.contractViolation = true
    throw error
  }
  return validated === true ? content : validated
}

// The fallback is OUR OWN deterministic contract, not a model guess - if it
// fails its own validator that is a bug in the fallback/validator pair, not
// a reason to throw a hard failure at a user who already just watched every
// AI provider fail. Observed live: documentPlan.js's outline validator
// rejected its own fallbackDocumentOutline() (a number/string part-id
// mismatch), which turned a solvable coverage bug into "no se pudo generar
// el documento" with zero pages produced. Logged (so the mismatch stays
// visible to fix) and the raw fallback content ships anyway - a
// deterministic answer that skipped one contract check beats no answer.
function applyFallbackContent(validator, task, fallbackContent) {
  if (!validator) return fallbackContent
  try {
    return validateContent(validator, fallbackContent)
  } catch (error) {
    console.error("Hybrid AI: deterministic fallback failed its own validator (task: " + task + ")", error)
    return fallbackContent
  }
}

// A failure that reflects NVIDIA being unavailable/unusable (worth counting
// toward the circuit breaker) vs. one that merely means "this answer didn't
// pass the contract" (must NOT count). Real availability failures are HTTP
// 5xx / 429 rate-limit / capacity / network drops / our own fetch timeout
// aborts. 429 was missing here (only >=500 counted): observed live, once
// NVIDIA starts rate-limiting it returns 429 on every single call, but since
// that never counted as a failure the circuit never opened - every task kept
// re-trying a provider that was consistently refusing, burning ~12s each time
// it could have skipped straight to Qwen/fallback instead.
function isAvailabilityFailure(error) {
  if (!error || error.contractViolation) return false
  if (typeof error.status === "number" && (error.status >= 500 || error.status === 429)) return true
  if (error.networkError || error.timedOut) return true
  // fetchWithTimeout aborts via its OWN controller and surfaces an AbortError;
  // that's a real "NVIDIA took too long" signal (distinct from the winner
  // aborting the loser, which is caught earlier via controller.signal.aborted).
  if (error.name === "AbortError") return true
  return false
}

function logTelemetry(entry) {
  if (typeof window === "undefined") return
  try {
    const previous = JSON.parse(window.localStorage.getItem(TELEMETRY_KEY) || "[]")
    window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify([...previous.slice(-99), entry]))
  } catch {}
}

async function providerAttempt(provider, options, controller, deadline) {
  const started = Date.now()
  const remaining = Math.max(1, deadline - started)
  const model = provider === "nvidia" ? NVIDIA_MODEL : undefined
  let attempts = 0
  while (attempts < 2) {
    attempts++
    try {
      const response = await requestAIOnce({
        ...options,
        provider,
        model,
        signal: controller.signal,
        timeoutMs: Math.max(1, deadline - Date.now()),
      })
      const content = validateContent(options.validator, response.content)
      if (provider === "nvidia") recordNvidiaSuccess()
      return { content, provider, model: response.model || model, latencyMs: Date.now() - started, degraded: provider !== "nvidia", fallbackReason: provider === "local" ? "deepseek_slow_or_invalid" : null }
    } catch (error) {
      if (controller.signal.aborted) throw error
      if (provider === "nvidia" && isAvailabilityFailure(error)) recordNvidiaFailure()
      if (!retryableCapacityError(error) || attempts >= 2 || Date.now() + 500 >= deadline) throw error
      await delay(Math.min(500, remaining), controller.signal)
    }
  }
}

async function streamProviderAttempt(provider, options, controller, deadline, onEvent) {
  const started = Date.now()
  let attempts = 0
  while (attempts < 2) {
    attempts++
    try {
      const response = await requestAIStreamOnce({
        ...options,
        provider,
        model: provider === "nvidia" ? NVIDIA_MODEL : undefined,
        signal: controller.signal,
        timeoutMs: Math.max(1, deadline - Date.now()),
        onEvent: (event) => onEvent && onEvent({ ...event, provider }),
      })
      const content = validateContent(options.validator, response.content)
      if (provider === "nvidia") recordNvidiaSuccess()
      return {
        content,
        provider,
        model: response.model || (provider === "nvidia" ? NVIDIA_MODEL : "qwen-local"),
        latencyMs: Date.now() - started,
        degraded: provider !== "nvidia",
        fallbackReason: provider === "local" ? "deepseek_slow_or_invalid" : null,
      }
    } catch (error) {
      if (controller.signal.aborted) throw error
      if (provider === "nvidia" && isAvailabilityFailure(error)) recordNvidiaFailure()
      if (!retryableCapacityError(error) || attempts >= 2 || Date.now() + 500 >= deadline) throw error
      await delay(500, controller.signal)
    }
  }
}

// studio.html's whole point is a Mistral-only, no-cloud-dependency build (see
// scripts/studio-ai.mjs) - but no caller here ever restricted `providers`, so
// every text task kept racing NVIDIA too as long as a valid NVIDIA_API_KEY
// happened to be configured for local dev. Observed live: NVIDIA's flaky
// free-tier DeepSeek answering first with a validator-rejecting response,
// racing against Mistral joining late (qwenDelayMs), producing exactly the
// "both providers failed" contract-violation error this was meant to avoid
// by having a private, NVIDIA-independent build at all. The public build's
// own default (nvidia+local, local as an opportunistic fallback) is
// unchanged - only the studio page gets pinned to local-only.
function defaultProviders() {
  return getTextAIProvider() === "local" ? ["local"] : ["nvidia", "local"]
}

function requestKey(task, messages, options) {
  return JSON.stringify([task, messages, options.maxTokens, options.temperature])
}

export function getHybridTelemetry() {
  if (typeof window === "undefined") return []
  try { return JSON.parse(window.localStorage.getItem(TELEMETRY_KEY) || "[]") } catch { return [] }
}

export function resetHybridAIForTests() {
  inflight.clear()
  activeOperations.clear()
  operationSequence = 0
  nvidiaFailures = []
  circuitOpenedAt = 0
  qwenHealth = { checkedAt: 0, available: null }
  qwenTail = Promise.resolve()
}

export async function runHybridAI({ task, messages, validator, fallback, onStatus, signal, maxTokens, temperature = 0.2, providers = defaultProviders(), operationId } = {}) {
  const policy = TASK_POLICIES[task]
  if (!policy) throw new Error("Unknown hybrid AI task: " + task)
  const options = { messages, validator, maxTokens: maxTokens || policy.maxTokens, temperature, thinking: !!policy.thinking }
  const enabled = new Set(providers)
  const key = requestKey(task, messages, options) + JSON.stringify([...enabled])
  if (inflight.has(key)) return inflight.get(key)
  const id = operationId || task + "-" + (++operationSequence)
  const previous = activeOperations.get(task)
  if (previous && previous.id !== id) previous.controller.abort("superseded")
  const operationAbort = composeAbort(signal)
  activeOperations.set(task, { id, controller: operationAbort.controller })

  const operation = (async () => {
    const started = Date.now()
    const deadline = started + policy.budgetMs
    const nvidia = composeAbort(operationAbort.controller.signal)
    const qwen = composeAbort(operationAbort.controller.signal)
    const failures = []
    let settled = false
    const heartbeat = withHeartbeat(onStatus)

    const accept = (result) => {
      if (settled || activeOperations.get(task)?.id !== id) throw abortError("stale_operation")
      settled = true
      if (result.provider === "nvidia") qwen.controller.abort("winner_selected")
      else nvidia.controller.abort("winner_selected")
      const seconds = Math.max(1, Math.round(result.latencyMs / 1000))
      heartbeat.status(`Respondido por ${providerLabel(result)} · ${seconds} s`)
      logTelemetry({ at: new Date().toISOString(), task, provider: result.provider, model: result.model, latencyMs: result.latencyMs, valid: true, fallbackReason: result.fallbackReason })
      return result
    }

    const candidates = []
    if (enabled.has("nvidia") && !circuitIsOpen()) {
      heartbeat.status("Consultando DeepSeek…")
      candidates.push(providerAttempt("nvidia", options, nvidia.controller, deadline).then(accept).catch((error) => { failures.push(error); throw error }))
    } else if (enabled.has("nvidia")) {
      failures.push(new Error("nvidia_circuit_open"))
      heartbeat.status("NVIDIA en pausa tras fallas recientes; usando el modelo local…")
    }

    const localCandidate = enabled.has("local") ? (async () => {
      await delay(!enabled.has("nvidia") || circuitIsOpen() ? 0 : policy.qwenDelayMs, qwen.controller.signal)
      if (!(await qwenAvailable())) throw new Error("qwen_unavailable")
      heartbeat.status(enabled.has("nvidia") ? "DeepSeek está tardando; probando el modelo local…" : "Consultando el modelo local…")
      return enqueueQwen(() => providerAttempt("local", options, qwen.controller, localDeadline(deadline))).then(accept)
    })().catch((error) => { failures.push(error); throw error }) : null
    if (localCandidate) candidates.push(localCandidate)

    try {
      return await Promise.any(candidates)
    } catch {
      if (operationAbort.controller.signal.aborted) throw abortError()
      let fallbackContent = typeof fallback === "function" ? await fallback() : fallback
      if (fallbackContent === undefined) throw failures[0] || new Error("No AI provider returned a valid response")
      fallbackContent = applyFallbackContent(validator, task, fallbackContent)
      const reason = failures.map((error) => error && (error.status || error.message)).filter(Boolean).join(",") || "providers_failed"
      const result = { content: fallbackContent, provider: "contract", model: "deterministic", latencyMs: Date.now() - started, degraded: true, fallbackReason: reason }
      heartbeat.status("Usando respuesta base verificable")
      logTelemetry({ at: new Date().toISOString(), task, provider: result.provider, model: result.model, latencyMs: result.latencyMs, valid: true, fallbackReason: reason })
      return result
    } finally {
      heartbeat.stop()
      nvidia.controller.abort("operation_finished")
      qwen.controller.abort("operation_finished")
      nvidia.dispose()
      qwen.dispose()
      operationAbort.dispose()
      if (activeOperations.get(task)?.id === id) activeOperations.delete(task)
    }
  })()

  inflight.set(key, operation)
  try { return await operation } finally { if (inflight.get(key) === operation) inflight.delete(key) }
}

// Streaming counterpart of runHybridAI. It keeps the same winner rule (the
// first provider whose FINAL response satisfies the task contract), while
// forwarding actual SSE chunks to the UI along the way.
export async function runHybridAIStream({ task, messages, validator, fallback, onStatus, onEvent, signal, maxTokens, temperature = 0.2, providers = defaultProviders(), operationId } = {}) {
  const policy = TASK_POLICIES[task]
  if (!policy) throw new Error("Unknown hybrid AI task: " + task)
  const options = { messages, validator, maxTokens: maxTokens || policy.maxTokens, temperature, thinking: !!policy.thinking }
  const enabled = new Set(providers)
  const key = requestKey(task, messages, options) + JSON.stringify([...enabled]) + ":stream"
  if (inflight.has(key)) return inflight.get(key)
  const id = operationId || task + "-stream-" + (++operationSequence)
  const previous = activeOperations.get(task)
  if (previous && previous.id !== id) previous.controller.abort("superseded")
  const operationAbort = composeAbort(signal)
  activeOperations.set(task, { id, controller: operationAbort.controller })

  const operation = (async () => {
    const started = Date.now()
    const deadline = started + policy.budgetMs
    const nvidia = composeAbort(operationAbort.controller.signal)
    const qwen = composeAbort(operationAbort.controller.signal)
    const failures = []
    let settled = false
    const heartbeat = withHeartbeat(onStatus)
    const accept = (result) => {
      if (settled || activeOperations.get(task)?.id !== id) throw abortError("stale_operation")
      settled = true
      if (result.provider === "nvidia") qwen.controller.abort("winner_selected")
      else nvidia.controller.abort("winner_selected")
      const seconds = Math.max(1, Math.round(result.latencyMs / 1000))
      heartbeat.status(`Respondido por ${providerLabel(result)} · ${seconds} s`)
      logTelemetry({ at: new Date().toISOString(), task, provider: result.provider, model: result.model, latencyMs: result.latencyMs, valid: true, fallbackReason: result.fallbackReason })
      return result
    }
    const candidates = []
    if (enabled.has("nvidia") && !circuitIsOpen()) {
      heartbeat.status("Consultando DeepSeek…")
      candidates.push(streamProviderAttempt("nvidia", options, nvidia.controller, deadline, onEvent).then(accept).catch((error) => { failures.push(error); throw error }))
    } else if (enabled.has("nvidia")) {
      failures.push(new Error("nvidia_circuit_open"))
      heartbeat.status("NVIDIA en pausa tras fallas recientes; usando el modelo local…")
    }
    if (enabled.has("local")) {
      candidates.push((async () => {
        await delay(!enabled.has("nvidia") || circuitIsOpen() ? 0 : policy.qwenDelayMs, qwen.controller.signal)
        if (!(await qwenAvailable())) throw new Error("qwen_unavailable")
        heartbeat.status(enabled.has("nvidia") ? "DeepSeek está tardando; probando el modelo local…" : "Consultando el modelo local…")
        return enqueueQwen(() => streamProviderAttempt("local", options, qwen.controller, localDeadline(deadline), onEvent)).then(accept)
      })().catch((error) => { failures.push(error); throw error }))
    }
    try {
      return await Promise.any(candidates)
    } catch {
      if (operationAbort.controller.signal.aborted) throw abortError()
      let fallbackContent = typeof fallback === "function" ? await fallback() : fallback
      if (fallbackContent === undefined) throw failures[0] || new Error("No AI provider returned a valid response")
      fallbackContent = applyFallbackContent(validator, task, fallbackContent)
      const reason = failures.map((error) => error && (error.status || error.message)).filter(Boolean).join(",") || "providers_failed"
      const result = { content: fallbackContent, provider: "contract", model: "deterministic", latencyMs: Date.now() - started, degraded: true, fallbackReason: reason }
      heartbeat.status("Usando respuesta base verificable")
      logTelemetry({ at: new Date().toISOString(), task, provider: result.provider, model: result.model, latencyMs: result.latencyMs, valid: true, fallbackReason: reason })
      return result
    } finally {
      heartbeat.stop()
      nvidia.controller.abort("operation_finished")
      qwen.controller.abort("operation_finished")
      nvidia.dispose()
      qwen.dispose()
      operationAbort.dispose()
      if (activeOperations.get(task)?.id === id) activeOperations.delete(task)
    }
  })()
  inflight.set(key, operation)
  try { return await operation } finally { if (inflight.get(key) === operation) inflight.delete(key) }
}
