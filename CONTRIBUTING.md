# Contributing

## Dev setup

```bash
git clone https://github.com/morfemartin/techpack-ai-builder.git
cd techpack-ai-builder
npm install
npm run dev
```

Optional: copy `.env.example` to `.env.local` and add an Anthropic API key to enable AI translation and PDF-based embroidery extraction. Everything else works without it.

## Adding a new garment type (the easiest way to contribute)

The garment engine is a plain data registry — no need to touch the wizard or SVG code. Copy `src/garments/cap.js` and fill in the same shape:

```js
export const yourGarment = {
  id: "tshirt",
  icon: "👕",
  label: { ES: "Camiseta", EN: "T-Shirt", ZH: "T恤" },
  defaultParts: [ { id: 1, val: "...", on: true }, ... ],
  partLabels: { ES: { 1: "..." }, EN: { 1: "..." }, ZH: { 1: "..." } },
  positions: { ES: ["Toda la prenda", ...], EN: [...], ZH: [...] },
  guides: [frontPath, backPath, leftPath, rightPath],   // SVG path `d` in a 0-200x0-150 viewBox
  callouts: [ [[partId, labelX, labelY, pointX, pointY], ...], ... ], // one array per view
}
```

Then register it in `src/garments/index.js`. That's the whole integration point — the wizard steps, SVG page builders, and preview all read from the registry.

## Code style

- Plain functional React (hooks, no class components).
- No CSS framework — inline `style={}` objects, matching the rest of the codebase.
- Keep SVG-building functions (`src/pages/buildPages.js`, `src/core/svgPrimitives.js`) framework-free (no JSX) since they also run outside React when generating downloadable files.

## Pull requests

1. Fork, branch off `main`.
2. `npm run build` must pass before opening the PR (CI checks this too).
3. Describe what changed and why in the PR body — screenshots/GIFs are especially useful for UI changes.
