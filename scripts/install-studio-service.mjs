import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const label = "com.morfe.techpack-studio-ai"
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const agents = join(homedir(), "Library", "LaunchAgents")
const logs = join(homedir(), "Library", "Logs", "TechPackAI")
const plist = join(agents, label + ".plist")
const domain = `gui/${process.getuid()}`

function xml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function launchctl(...args) {
  return spawnSync("/bin/launchctl", args, { stdio: "ignore" })
}

if (process.argv.includes("--uninstall")) {
  launchctl("bootout", domain, plist)
  if (existsSync(plist)) rmSync(plist)
  console.log("Studio AI login service removed.")
  process.exit(0)
}

mkdirSync(agents, { recursive: true })
mkdirSync(logs, { recursive: true })
const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(root, "scripts", "studio-ai.mjs"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>HF_XET_HIGH_PERFORMANCE</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(logs, "studio-ai.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, "studio-ai.error.log"))}</string>
</dict></plist>
`

writeFileSync(plist, contents, { mode: 0o600 })
chmodSync(plist, 0o600)
launchctl("bootout", domain, plist)
const result = launchctl("bootstrap", domain, plist)
if (result.status !== 0) {
  console.error("Could not install the Studio AI login service.")
  process.exit(1)
}
launchctl("kickstart", "-k", `${domain}/${label}`)
console.log(`Studio AI login service installed: ${plist}`)
