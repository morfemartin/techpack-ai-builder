# Changelog

See `ROADMAP.md` for the full, phase-by-phase development log with
verification notes; this file tracks user-facing releases at a higher level.

## [Unreleased]
### Added
- One-button Illustrator/Affinity export: "Descargar ficha completa" produces
  a single ZIP (`pages/*.svg`, self-contained with images embedded inline;
  the `Techpack-Import-Illustrator.jsx` importer; a `LEEME.txt` with the
  3-step run instructions) instead of four separate format downloads. The
  JSX importer opens each page as its own document inside Illustrator and
  fuses them into one `Techpack-complete.ai` with named artboards (4-column
  grid) and the 7 native semantic layers - Illustrator discards a plain SVG's
  group ids on direct import, so the script is the only path to real layers.
  Affinity needs no script: any page under `pages/` opens directly.
- Post-download confirmation in the export dialog restates the 3 steps right
  after the ZIP downloads, not only beforehand.

## [0.1.0] - 2026-07-01
### Added
- Initial public release.
- Multi-garment architecture: garments are registered in `src/garments/index.js`, each one supplying its own parts, part labels (ES/EN/ZH), design positions, and 4-view silhouette/callout diagram.
- First garment: **Cap** — full parts spec sheet, 4-view technical diagram with numbered callouts, per-design Pantone/Madeira color specs (auto CMYK from hex), embroidery tech sheet with stop-sequence, optional AI extraction of embroidery specs from a Wilcom PDF worksheet, and ES/EN/ZH export with optional AI translation.
- Per-page SVG export (copy to clipboard or download), one artboard-ready file per page.
