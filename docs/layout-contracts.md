# Layout Engine v2 — how the program "thinks like a tech-pack designer"

This is the architecture behind the generated tech-pack document: how a weak
model's proposal becomes a correct, aligned, dead-space-free page. The guiding
principle is a division of labor — **the AI proposes, deterministic code
disposes**. DeepSeek (a small model) only ever makes small, closed-vocabulary
decisions; every guarantee lives in code that validates and repairs whatever
it returns. A bad AI answer degrades to a sensible default, it can never break
a page.

Verify any of this visually in the [Layout Lab](layout-lab/README.md):
`npm run dev` → http://localhost:3001/layout-lab.html.

---

## The two problems this solves

**P1 — misalignment.** Every block renderer used to invent its own geometry:
left insets of 8/10/12/14/38/44px, value columns at 0.5/0.52/0.55, six
different row-height regimes, a parts-table header whose captions never sat
over its own rows. Rules and columns from different blocks never lined up.

**P2 — dead white space.** The solver handed each region a box sized by the
AI's weight; the renderer drew its natural-size content and stopped, leaving
the rest of the box blank. Nothing shrank a block to its content or gave the
freed space back. (The intentional blank of an illustration placeholder is
*not* this — that's where art goes.)

---

## The pipeline

```
intake (parts, designs, header)
        │
        ▼
planDocumentOutline ──► repairOutline ──► [cover, overview, design:…, …]
   (AI: which pages)     (contract)         every design covered once,
                                            cover + full-BOM page guaranteed
        │
        ▼   per page
planPageLayout ──► normalizePlan ──► repairPage ──► regions
   (AI: regions,     (drop unknown)   (contract)     mandatory present,
    weights,                                          forbidden/empty/dupes
    briefs[])                                         gone, chrome ordered
        │
        ▼
interpretPagePlan  ──►  measure-then-solve  ──►  solveLayout  ──►  SVG
   (build the tree)      (content-sized blocks,   (whole-pixel
                          slack to absorbers)       snapping)
        │
        ▼
buildReviewFindings ──► ReviewChat (only if problems) ──► export
   (intent vs document)
```

---

## The five pieces

### 1. Shared metrics (`src/design/metrics.js`) — kills P1

One geometric source of truth on the tokens 4px grid, consumed by **every**
renderer: a single content `INSET`, one `COL` column template used by both
table headers and rows, a `ROW` height scale, one `CHIP` size, full-width
section bars (`svgSectionBar`), and a header grid where the width splits into
five modules so both header rows share every vertical edge. `solveLayout` then
snaps every box to whole pixels **edge-wise** (start and end rounded, size
derived) so adjacent boxes still share exactly one edge — crisp hairlines,
coincident edges across blocks.

### 2. Measure-then-solve (`src/pages/measure.js` + solver) — kills P2

`measureRegion()` answers, per region type, "how tall does this block want to
be for its actual data?" — mirroring each renderer's exact geometry.
`interpretPagePlan` then sizes a page so **bounded data blocks take their
natural height** (`grow: 0`, compressible only toward a legible floor) and
**every leftover pixel flows to the absorbers** (illustration/spacer, or a
split containing one), divided by the plan weights. A page with no absorber
parks its slack in one invisible spacer above the bottom chrome, so the
disclaimer stays pinned. The AI's weights now express *priority among
absorbers*, not arbitrary heights for data — a two-row table can no longer be
stretched into a half-page band of white. The solver also runs the real
flexbox multi-pass loop, so a child that clamps at its max/min hands the
surplus back to its siblings instead of losing it.

### 3. Page contracts (`src/pages/pageContracts.js`) — the designer's brain

`CONTRACTS[purpose]` encodes, per page family
(`cover`/`overview`/`structure`/`lining`/`label`/`design`): which regions are
**mandatory**, which are **forbidden** (a `partsList` — the full BOM — is
forbidden on a design page; it lives once, on the overview), and which are
**conditionally mandatory** (a design page shows `colorSpecs` only if that
design has colors, `embSpecs` only if it has embroidery data).

- `validatePage` / `repairPage`: drop forbidden, empty-data, and duplicate
  regions (inside splits too), insert missing mandatory regions with
  per-purpose defaults, enforce canonical chrome order (header → title →
  content → disclaimer).
- `validateOutline` / `repairOutline`: cover page first, at least one full-BOM
  page, every design covered exactly once.

This is where the four designer questions become code: *what deserves its own
page* (outline), *what must be visually present* (mandatory), *what never
repeats* (forbidden + one-BOM rule), *how do I represent this most orderly*
(measure-then-solve + canonical order).

### 4. Structured illustrator briefs (`src/pages/briefs.js`)

Each illustration slot gets a brief that answers — inside the art board, never
taking layout space — which garment part goes here, what the drawing **must
mark**, which **measurements** to draw (with the dimension-line convention,
flagged per-size when they grade), and the **factory note**. The AI fills a
`briefs[]` array guided by two thinking models: (a) what drawn/dimensioned
elements keep the factory faithful to the client's intent, and (b) what a
skilled illustrator *without* textile knowledge needs to finish the
schematics. `normalizeSlotBriefs` guarantees the shape and derives defaults
from the design's own data; `briefLines` renders a standard template with a
degradation ladder (full → checklist → title) so every slot explains itself
legibly at any cell size.

### 5. Pre-download review (`src/core/reviewDiff.js` + `ReviewChat`)

Before export, `buildReviewFindings` diffs the intake truth against the
generated document: each datum is **confirmed** (lands on a page), **missing**
(empty in the intake), or **unplaced** (exists but no page carries it). Only
the problems become a short chat with numbered options
(`findingsToWalkFields`), so the review runs even with zero AI availability; a
bounded DeepSeek call just rephrases them conversationally. Confirmed data is
a one-line summary, never re-asked. Always skippable — the review protects the
user, it never holds the download hostage.

---

## Why DeepSeek can execute this

Every runtime AI decision is a small closed-vocabulary JSON object
(`{regions:[{type, weight, slots, refs, briefs}]}`, `{pages:[{purpose,
pieces}]}`) that is normalized, validated, and repaired deterministically. The
prompt teaches the model to think like a designer; the code guarantees the
result regardless of how well it did. Several of the pure modules here
(`measure.js`, the solver's redistribution loop, `pageContracts` validate/
repair, `briefs` normalizer, `reviewDiff`) were drafted by the local DeepSeek
orchestrator against exact contract tests, then reviewed and integrated — the
same "delegate the self-contained, review the integration" split used
throughout this project's build-out.
