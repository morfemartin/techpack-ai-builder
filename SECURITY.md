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
- The proxy caps `max_tokens` and message count so a discovered endpoint cannot
  be used to run up unbounded charges on the account.
- Dependabot watches npm and GitHub Actions dependencies for known vulnerabilities.
- GitHub secret scanning + push protection are enabled on the repository.

## Hardening backlog (not yet implemented)

- Rate limiting / abuse protection on the proxy (KV-based limiter or Vercel's
  built-in protection) before any public, unauthenticated deployment.
- An origin/shared-secret check so only your own front-end can call the proxy.

## If a key is ever exposed

Rotate it immediately in the NVIDIA dashboard, then update the environment
variable in Vercel (and your local `.env.local`). A rotated key makes any leaked
copy useless.
