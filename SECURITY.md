# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, open a
private [GitHub Security Advisory](https://github.com/morfemartin/techpack-ai-builder/security/advisories/new)
or contact the maintainer directly. We aim to respond within a few days.

## How API keys are handled (read this before deploying)

This project uses DeepSeek (via NVIDIA's OpenAI-compatible API) for the AI
intake and translation features. The key is treated as follows:

- **The key never lives in the repository and never reaches the browser.** All
  AI calls go through a server-side proxy (`api/deepseek.js`) that reads
  `process.env.NVIDIA_API_KEY`. The client (`src/core/deepseekClient.js`) only
  ever talks to `/api/deepseek`.
- The key variable is **not** prefixed with `VITE_`. Vite only exposes
  `VITE_`-prefixed variables to the client bundle, so this guarantees the key is
  never compiled into the shipped JavaScript.
- Local development: put the key in `.env.local` (which is gitignored). Never in
  `.env`, never in committed files.
- Deployment (Vercel): set the key under **Project Settings → Environment
  Variables**, not in the repo.

## Guardrails already in place

- `.gitignore` covers `.env`, `.env.local`, `*.local`, and `.vercel`.
- CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push/PR to
  catch accidentally committed secrets.
- The proxy caps `max_tokens` per request so a discovered endpoint cannot be
  used to run up unbounded charges on a single call.
- Dependabot watches npm and GitHub Actions dependencies for known vulnerabilities.
- The optional studio model binds only to `127.0.0.1` behind a restricted
  bridge. It accepts text only, forces one configured model, caps request size,
  message count and output tokens, validates `Host`, and allows only configured
  browser origins. See `docs/STUDIO-AI.md`.
- GitHub secret scanning + push protection are enabled on the repository.

## Hardening backlog (not yet implemented)

- Rate limiting / abuse protection on the proxy (KV-based limiter or Vercel's
  built-in protection) before any public, unauthenticated deployment.
- **Per-request message-count cap**: temporarily removed during development
  (the multi-phase systemic-thinking chat resends the whole conversation each
  turn, and long real chats were hitting the old 40-message limit mid-flow).
  Restore it before the public launch — ideally paired with client-side history
  trimming/summarization so we cap abuse without truncating legitimate long
  conversations. See the TODO in `api/deepseek.js`.
- **Known accepted risk:** `vite`/`esbuild`/`vitest` dev-tooling vulnerabilities
  (GHSA-67mh-4wv8-2f99 and related, including a GitHub-flagged *critical* in
  `vitest` about its optional UI server allowing arbitrary file read/execute)
  only fix via a Vite 5→8 major upgrade, intentionally deferred (see
  `.github/dependabot.yml`) until it can be tested deliberately. All of these
  affect dev-time tooling only, not production builds:
  - `npm run dev`: don't expose it to an untrusted network.
  - The `vitest` critical requires running `vitest --ui` (a browser-based test
    UI). This project's `npm test` runs `vitest run` (headless, no UI server)
    and no script/doc in this repo invokes `--ui` — don't add one without
    re-checking this advisory first.
- An origin/shared-secret check so only your own front-end can call the public
  NVIDIA proxy. The private studio bridge already enforces an origin allowlist.

## If a key is ever exposed

Rotate it immediately in the NVIDIA dashboard, then update the environment
variable in Vercel (and your local `.env.local`). A rotated key makes any leaked
copy useless.
