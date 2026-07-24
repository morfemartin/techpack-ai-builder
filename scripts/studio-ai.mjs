import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadEnvLocal } from "./loadEnvLocal.mjs"
import { createStudioBridge, DEFAULT_ALLOWED_ORIGINS, DEFAULT_STUDIO_MODEL } from "./studioBridge.mjs"

loadEnvLocal()

const bridgePort = Number(process.env.STUDIO_BRIDGE_PORT) || 11435
const allowedOrigins = process.env.STUDIO_ALLOWED_ORIGINS
  ? process.env.STUDIO_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS

const mistralApiKey = process.env.MISTRAL_API_KEY || ""

// Two upstreams for the same private bridge: a paid hosted model (Mistral)
// when a key is configured in .env.local, or the offline local MLX model
// otherwise - no code path change needed by whoever runs `npm run studio:ai`,
// just whether that file has a key in it. The PUBLIC deploy (gh-pages +
// Vercel) is untouched either way: it never reads .env.local and keeps using
// NVIDIA through api/deepseek.js exactly as before.
if (mistralApiKey) {
  runWithHostedUpstream()
} else {
  runWithLocalModel()
}

function runWithHostedUpstream() {
  const model = process.env.MISTRAL_MODEL || "mistral-small-2603"
  const readiness = { status: "ready" } // no local warmup needed - it's a hosted API
  const bridge = createStudioBridge({
    upstreamBaseURL: "https://api.mistral.ai/v1",
    model,
    allowedOrigins,
    readiness,
    apiKey: mistralApiKey,
    provider: "mistral",
  })
  bridge.listen(bridgePort, "127.0.0.1", () => {
    console.log(`[studio-ai] private bridge: http://127.0.0.1:${bridgePort}`)
    console.log(`[studio-ai] upstream: Mistral (${model})`)
    console.log(`[studio-ai] allowed origins: ${allowedOrigins.join(", ")}`)
  })
  process.on("SIGINT", () => bridge.close(() => process.exit(0)))
  process.on("SIGTERM", () => bridge.close(() => process.exit(0)))
}

function runWithLocalModel() {
  const model = process.env.STUDIO_AI_MODEL || DEFAULT_STUDIO_MODEL
  const modelPort = Number(process.env.STUDIO_MODEL_PORT) || 11436
  const executable = process.env.MLX_LM_SERVER || join(homedir(), ".local", "bin", "mlx_lm.server")

  if (!existsSync(executable)) {
    console.error("mlx_lm.server is not installed. Run: uv tool install mlx-lm")
    process.exit(1)
  }

  const modelServer = spawn(executable, [
    "--model", model,
    "--host", "127.0.0.1",
    "--port", String(modelPort),
    "--allowed-origins", "http://127.0.0.1",
    "--max-tokens", "4096",
    "--temp", "0.0",
    "--prompt-cache-size", "2",
    "--prompt-cache-bytes", String(2 * 1024 * 1024 * 1024),
    "--chat-template-args", '{"enable_thinking":false}',
  ], { stdio: "inherit" })

  const readiness = { status: "starting" }
  const bridge = createStudioBridge({
    upstreamBaseURL: `http://127.0.0.1:${modelPort}/v1`,
    model,
    allowedOrigins,
    readiness,
    provider: "mlx",
  })

  bridge.listen(bridgePort, "127.0.0.1", () => {
    console.log(`[studio-ai] private bridge: http://127.0.0.1:${bridgePort}`)
    console.log(`[studio-ai] model: ${model}`)
    console.log(`[studio-ai] allowed origins: ${allowedOrigins.join(", ")}`)
  })

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  async function warmModel() {
    for (;;) {
      try {
        const models = await fetch(`http://127.0.0.1:${modelPort}/v1/models`, { signal: AbortSignal.timeout(3000) })
        if (!models.ok) throw new Error("model server starting")
        const completion = await fetch(`http://127.0.0.1:${modelPort}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply only: OK" }], max_tokens: 2, temperature: 0 }),
          signal: AbortSignal.timeout(300000),
        })
        if (!completion.ok) throw new Error("warmup failed")
        readiness.status = "ready"
        console.log("[studio-ai] Qwen loaded and inference-ready")
        return
      } catch {
        readiness.status = "starting"
        await sleep(2000)
      }
    }
  }

  warmModel()

  function shutdown() {
    bridge.close()
    modelServer.kill("SIGTERM")
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
  modelServer.on("exit", (code) => {
    bridge.close()
    process.exit(code ?? 1)
  })
}
