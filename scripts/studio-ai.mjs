import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createStudioBridge, DEFAULT_ALLOWED_ORIGINS, DEFAULT_STUDIO_MODEL } from "./studioBridge.mjs"

const model = process.env.STUDIO_AI_MODEL || DEFAULT_STUDIO_MODEL
const modelPort = Number(process.env.STUDIO_MODEL_PORT) || 11436
const bridgePort = Number(process.env.STUDIO_BRIDGE_PORT) || 11435
const executable = process.env.MLX_LM_SERVER || join(homedir(), ".local", "bin", "mlx_lm.server")
const allowedOrigins = process.env.STUDIO_ALLOWED_ORIGINS
  ? process.env.STUDIO_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS

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
