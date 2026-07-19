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

export const TASK_POLICIES = {
  intake: { qwenDelayMs: 6000, budgetMs: 25000, maxTokens: 3800 },
  designs: { qwenDelayMs: 8000, budgetMs: 35000, maxTokens: 3200 },
  briefs: { qwenDelayMs: 10000, budgetMs: 45000, maxTokens: 3600 },
  explain: { qwenDelayMs: 3000, budgetMs: 12000, maxTokens: 700 },
  notes: { qwenDelayMs: 5000, budgetMs: 20000, maxTokens: 1800 },
  review: { qwenDelayMs: 4000, budgetMs: 15000, maxTokens: 1200 },
  outline: { qwenDelayMs: 20000, budgetMs: 180000, maxTokens: 4000, thinking: true },
  "page-layout": { qwenDelayMs: 12000, budgetMs: 120000, maxTokens: 2500 },
}
