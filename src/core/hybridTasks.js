export const HYBRID_TASKS = {
  INTAKE: "intake",
  DESIGNS: "designs",
  BRIEFS: "briefs",
  EXPLAIN: "explain",
  NOTES: "notes",
  REVIEW: "review",
  OUTLINE: "outline",
  PAGE_LAYOUT: "page-layout",
}

// budgetMs is BOTH the total race deadline AND the per-provider fetch timeout,
// so it must clear NVIDIA's real cold-start (observed 20-30s) inside the proxy's
// 55s ceiling - otherwise a slow-but-fine call is aborted early and (until the
// circuit-breaker fix) counted as an outage. The short explain/review/intake
// budgets were the second half of the "casi inútil" regression. qwenDelayMs
// (when the local model JOINS the race) stays small so Qwen still covers a
// genuinely slow NVIDIA quickly.
// qwenDelayMs decides WHO USUALLY WINS, not just who starts.
//
// The local model is a 8B 4-bit build: fast, private, and clearly weaker at
// domain reasoning than the hosted one. With the old 4-10s delays it beat
// NVIDIA's real 30-90s round trip on essentially every call - telemetry over
// a working session: intake 7/8, designs 3/3, briefs 2/2, page-layout 8/8 all
// won by the local model. So the "hybrid race" was really "local by default",
// and the quality showed: a pair of socks got asked about a CHEST embroidered
// logo, and a mountain jacket got a hallucinated "Uso techo" question. The one
// call NVIDIA did win produced the good output (water column, pit zips,
// Gore-Tex).
//
// So for the reasoning-heavy tasks the local model now joins late enough that
// the hosted one gets a genuine chance to answer first, and is what it was
// always meant to be: the rescue, not the default. This costs nothing when
// NVIDIA is actually unavailable - circuitIsOpen() makes the delay 0, so a
// rate-limited or down provider hands over to Qwen immediately (see
// isAvailabilityFailure, which counts 429s for exactly this reason).
//
// explain/notes stay eager on purpose: short interactive replies where waiting
// is felt immediately and a weaker answer costs little.
export const TASK_POLICIES = {
  intake: { qwenDelayMs: 30000, budgetMs: 45000, maxTokens: 3800 },
  designs: { qwenDelayMs: 26000, budgetMs: 40000, maxTokens: 3200 },
  briefs: { qwenDelayMs: 30000, budgetMs: 45000, maxTokens: 3600 },
  explain: { qwenDelayMs: 3000, budgetMs: 30000, maxTokens: 700 },
  notes: { qwenDelayMs: 5000, budgetMs: 30000, maxTokens: 1800 },
  review: { qwenDelayMs: 22000, budgetMs: 35000, maxTokens: 1200 },
  // Capped just under api/deepseek.js's own UPSTREAM_TIMEOUT_MS (55000ms,
  // hardcoded server-side): a budgetMs at or above that ceiling never lets
  // OUR client-side abort fire first, so every stalled call rides out the
  // full 55s as a 504 - which is itself a retryableCapacityError, so
  // providerAttempt then tries NVIDIA a SECOND full 55s before giving up
  // (~110s wasted per page, observed live). Staying under 55s means our own
  // AbortError fires first instead (not retried), handing off to Qwen/
  // fallback in one bounded pass.
  outline: { qwenDelayMs: 32000, budgetMs: 50000, maxTokens: 4000, thinking: true },
  "page-layout": { qwenDelayMs: 32000, budgetMs: 50000, maxTokens: 2500 },
}
