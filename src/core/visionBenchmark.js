function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function searchableVisionText(result) {
  const analysis = result && result.analysis ? result.analysis : result || {}
  return normalize([
    analysis.garmentType,
    analysis.view,
    ...(analysis.observations || []).flatMap((observation) => [observation.category, observation.value]),
  ].join(" "))
}

const CLAIM_CATEGORIES = {
  color: ["color"],
  material: ["material_appearance"],
  pattern: ["artwork", "material_appearance", "color"],
  print: ["artwork"],
  "print-colors": ["artwork", "color"],
  artwork: ["artwork", "label_text"],
  pocket: ["pocket"],
  pockets: ["pocket"],
  waist: ["waistband", "closure", "construction"],
  loops: ["waistband", "construction", "closure"],
  collar: ["construction"],
  hood: ["construction"],
  fit: ["silhouette", "construction"],
  silhouette: ["silhouette"],
  length: ["silhouette"],
  finish: ["finish"],
  hem: ["finish"],
  closure: ["closure"],
  pleats: ["construction"],
  labels: ["label_text"],
}

function searchableClaimText(result, claimId) {
  const analysis = result && result.analysis ? result.analysis : result || {}
  if (claimId === "type") return normalize(analysis.garmentType)
  if (claimId === "view") return normalize(analysis.view)
  const categories = CLAIM_CATEGORIES[claimId]
  if (!categories) return searchableVisionText(result)
  return normalize((analysis.observations || [])
    .filter((observation) => categories.includes(observation.category))
    .flatMap((observation) => [observation.attribute, observation.value])
    .join(" "))
}

export function scoreVisionResult(result, fixture) {
  const text = searchableVisionText(result)
  const claims = Array.isArray(fixture && fixture.expectedClaims) ? fixture.expectedClaims : []
  const scoredClaims = claims.map((claim) => {
    const terms = Array.isArray(claim.terms) ? claim.terms : []
    const claimText = searchableClaimText(result, claim.id)
    const matchedTerm = terms.find((term) => claimText.includes(normalize(term))) || null
    return { id: claim.id, weight: Number(claim.weight) || 1, matched: !!matchedTerm, matchedTerm }
  })
  const possible = scoredClaims.reduce((sum, claim) => sum + claim.weight, 0)
  const earned = scoredClaims.filter((claim) => claim.matched).reduce((sum, claim) => sum + claim.weight, 0)
  const forbiddenMatches = (fixture && fixture.forbiddenClaims || []).filter((claim) => text.includes(normalize(claim)))
  const coverage = possible > 0 ? earned / possible : 0
  const hallucinationPenalty = Math.min(0.5, forbiddenMatches.length * 0.1)
  const affinity = Math.max(0, coverage - hallucinationPenalty)
  return {
    affinity: Number(affinity.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    hallucinationPenalty: Number(hallucinationPenalty.toFixed(4)),
    passed: affinity >= Number(fixture && fixture.minimumAffinity || 0.8) && forbiddenMatches.length === 0,
    claims: scoredClaims,
    forbiddenMatches,
  }
}

export function summarizeVisionBenchmark(entries, minimumAffinity = 0.8) {
  const safe = Array.isArray(entries) ? entries : []
  const average = safe.length > 0 ? safe.reduce((sum, entry) => sum + Number(entry.score && entry.score.affinity || 0), 0) / safe.length : 0
  const passed = safe.filter((entry) => entry.score && entry.score.passed === true && entry.score.affinity >= minimumAffinity).length
  return {
    minimumAffinity,
    averageAffinity: Number(average.toFixed(4)),
    passed,
    failed: safe.length - passed,
    total: safe.length,
    allPassed: safe.length > 0 && passed === safe.length,
  }
}
