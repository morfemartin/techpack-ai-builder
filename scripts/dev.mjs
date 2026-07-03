// Local dev entrypoint: `npm run dev` needs BOTH the Vite dev server AND a way
// to serve api/deepseek.js, since api/deepseek.js is a Vercel serverless
// function and plain `vite dev` never executes /api/* routes on its own.
//
// `vercel dev` is the "real" way to run a Vercel function locally, but it
// requires an interactive OAuth login to a Vercel account on first run - not
// something this script can (or should) do on a contributor's behalf. So
// instead this spins up a tiny local HTTP server that runs the EXACT SAME
// handler code as production, and Vite's dev-server proxy (see
// vite.config.js) forwards /api/* requests to it. Zero new dependencies,
// zero Vercel account needed for local dev; production still deploys via
// real Vercel functions, untouched.
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local by hand instead of relying on `node --env-file`, which
// isn't in every Node 18+ (the version this project targets - see README).
// Same KEY=VALUE-per-line format, comments and blank lines ignored, existing
// process.env values win (so a real deploy environment is never overridden).
function loadEnvLocal() {
  const path = join(__dirname, "..", ".env.local")
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvLocal()

// Dynamic import so the handler picks up the env vars loadEnvLocal() just set.
const { default: deepseekHandler } = await import("../api/deepseek.js")

const API_PORT = process.env.DEV_API_PORT || 3002

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

const apiServer = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost")
  if (pathname !== "/api/deepseek") {
    res.statusCode = 404
    res.end("not found")
    return
  }

  const raw = await readBody(req)
  try {
    req.body = raw ? JSON.parse(raw) : {}
  } catch {
    req.body = {}
  }

  // Minimal shim of the Vercel response API surface that api/deepseek.js uses.
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(obj))
  }

  try {
    await deepseekHandler(req, res)
  } catch (e) {
    res.statusCode = 500
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ error: "dev_shim_error", detail: String((e && e.message) || e) }))
  }
})

apiServer.listen(API_PORT, () => {
  console.log(`[dev-api] /api/deepseek shim listening on http://localhost:${API_PORT}`)
})

const vite = spawn("npx", ["vite"], { stdio: "inherit", shell: process.platform === "win32" })
vite.on("exit", (code) => {
  apiServer.close()
  process.exit(code ?? 0)
})
