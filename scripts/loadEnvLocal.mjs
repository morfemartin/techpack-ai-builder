import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Loads .env.local by hand instead of relying on `node --env-file`, which
// isn't in every Node 18+ (the version this project targets - see README).
// KEY=VALUE per line, comments and blank lines ignored, existing process.env
// values win (so a real deploy environment is never overridden). Shared by
// dev.mjs (the local Vercel-function shim) and studio-ai.mjs (the local
// model bridge) - both need the same file read the same way.
export function loadEnvLocal() {
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
