import { DeepSeekError, getLocalAIHealth, requestAIOnce } from "./deepseekClient.js"
import { TASK_POLICIES } from "./hybridTasks.js"
export { HYBRID_TASKS, TASK_POLICIES } from "./hybridTasks.js"

const NVIDIA_MODEL = "deepseek-ai/deepseek-v4-pro"
const CIRCUIT_FAILURES = 2
const CIRCUIT_WINDOW_MS = 60000
const CIRCUIT_OPEN_MS = 60000
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

function retryableCapacityError(error) {
  return error && (error.status === 503 || error.status === 504)
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
  if (validated === false || validated == null) throw new DeepSeekError("La respuesta no cumple el contrato de la tarea.")
  return validated === true ? content : validated
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
      if (provider === "nvidia") recordNvidiaFailure()
      if (!retryableCapacityError(error) || attempts >= 2 || Date.now() + 500 >= deadline) throw error
      await delay(Math.min(500, remaining), controller.signal)
    }
  }
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

export async function runHybridAI({ task, messages, validator, fallback, onStatus, signal, maxTokens, temperature = 0.2, providers = ["nvidia", "local"], operationId } = {}) {
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

    const accept = (result) => {
      if (settled || activeOperations.get(task)?.id !== id) throw abortError("stale_operation")
      settled = true
      if (result.provider === "nvidia") qwen.controller.abort("winner_selected")
      else nvidia.controller.abort("winner_selected")
      const seconds = Math.max(1, Math.round(result.latencyMs / 1000))
      onStatus && onStatus(result.provider === "local" ? `Respondido por Qwen · ${seconds} s` : `Respondido por DeepSeek · ${seconds} s`)
      logTelemetry({ at: new Date().toISOString(), task, provider: result.provider, model: result.model, latencyMs: result.latencyMs, valid: true, fallbackReason: result.fallbackReason })
      return result
    }

    const candidates = []
    if (enabled.has("nvidia") && !circuitIsOpen()) {
      onStatus && onStatus("Consultando DeepSeek…")
      candidates.push(providerAttempt("nvidia", options, nvidia.controller, deadline).then(accept).catch((error) => { failures.push(error); throw error }))
    } else if (enabled.has("nvidia")) {
      failures.push(new Error("nvidia_circuit_open"))
    }

    const localCandidate = enabled.has("local") ? (async () => {
      await delay(!enabled.has("nvidia") || circuitIsOpen() ? 0 : policy.qwenDelayMs, qwen.controller.signal)
      if (!(await qwenAvailable())) throw new Error("qwen_unavailable")
      onStatus && onStatus(enabled.has("nvidia") ? "DeepSeek está tardando; probando Qwen local…" : "Consultando Qwen local…")
      return enqueueQwen(() => providerAttempt("local", options, qwen.controller, deadline)).then(accept)
    })().catch((error) => { failures.push(error); throw error }) : null
    if (localCandidate) candidates.push(localCandidate)

    try {
      return await Promise.any(candidates)
    } catch {
      if (operationAbort.controller.signal.aborted) throw abortError()
      let fallbackContent = typeof fallback === "function" ? await fallback() : fallback
      if (fallbackContent === undefined) throw failures[0] || new Error("No AI provider returned a valid response")
      fallbackContent = validateContent(validator, fallbackContent)
      const reason = failures.map((error) => error && (error.status || error.message)).filter(Boolean).join(",") || "providers_failed"
      const result = { content: fallbackContent, provider: "contract", model: "deterministic", latencyMs: Date.now() - started, degraded: true, fallbackReason: reason }
      onStatus && onStatus("Usando respuesta base verificable")
      logTelemetry({ at: new Date().toISOString(), task, provider: result.provider, model: result.model, latencyMs: result.latencyMs, valid: true, fallbackReason: reason })
      return result
    } finally {
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
