# Private Studio AI

The studio build uses a local text model while keeping image analysis on the
existing NVIDIA server-side proxy.

## Architecture

- Text, intake, document planning and review: `mlx-community/Qwen3-8B-4bit`.
- Image analysis: NVIDIA Vision through `/api/deepseek`; the key remains on the
  server and never reaches the browser.
- Geometry, pagination and contract repair: deterministic application code.
- GitHub Pages remains a static UI. The local model is never uploaded to or
  executed by GitHub.

The browser calls `http://127.0.0.1:11435`. The bridge calls the MLX server on
`http://127.0.0.1:11436`. Both bind to loopback only.

## One-time setup

```bash
uv tool install mlx-lm
npm run studio:ai
```

The first start downloads the 4-bit model to the user's Hugging Face cache.
Model files, prompts and outputs are not stored in this repository.

After validating the model once, install the optional login service:

```bash
npm run studio:install
```

It starts Qwen automatically for this macOS user and writes operational logs
under `~/Library/Logs/TechPackAI`. Remove it with `npm run studio:uninstall`.

Open the studio mode locally:

```text
http://localhost:3000/?studio=local
http://localhost:3000/layout-lab.html?studio=local
```

The same query parameter works from the published GitHub Pages UI when the
bridge is running on this Mac. It persists the local provider choice in that
browser. Use `?studio=nvidia` to switch text back to the remote provider.

## Security boundaries

- The bridge binds only to `127.0.0.1`; it is not reachable from the LAN.
- Browser origins are an explicit allowlist. The default production origin is
  `https://morfemartin.github.io` plus the two local development origins.
- The host header is restricted to loopback names to reduce DNS-rebinding risk.
- Requests are capped at 1 MiB, 64 messages and 4096 output tokens.
- The configured model is forced server-side; clients cannot select arbitrary
  local models or paths.
- Image payloads are rejected by the local bridge. Vision remains on NVIDIA.
- The bridge has no API key, shell endpoint, filesystem endpoint or arbitrary
  upstream URL.
- There is no silent cloud fallback in studio text mode. If Qwen is offline,
  the UI reports it instead of sending private text to NVIDIA.

Override the allowlist only when needed:

```bash
STUDIO_ALLOWED_ORIGINS=https://morfemartin.github.io npm run studio:ai
```

Do not expose ports `11435` or `11436` through a router, tunnel, reverse proxy
or macOS sharing service.

## Model choice

Qwen3-8B 4-bit is the stable target for the 16 GB Apple M4 studio machine. It
leaves enough unified memory for the browser, prompt cache and document render.
Larger 12B-14B models are not used as the operational default because their
memory pressure reduces usable context and system stability on this machine.
