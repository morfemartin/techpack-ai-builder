import { EMPTY_EMB } from "./helpers.js"
import { repairOutline, repairPage } from "../pages/pageContracts.js"

function clone(value, fallback) {
  if (value == null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function designPageName(page) {
  const purpose = page && typeof page.purpose === "string" ? page.purpose.trim() : ""
  return purpose.startsWith("design:") ? purpose.slice("design:".length).trim() : ""
}

function sameText(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase()
}

function fullBomPage(pages) {
  return pages.find((page) => {
    const purpose = String((page && page.purpose) || "")
    const unrestricted = !Array.isArray(page && page.pieces) || page.pieces.length === 0
    return unrestricted && ["overview", "structure", "lining"].includes(purpose)
  })
}

function parseAnswerKey(key) {
  const match = /^review:([^:]+):(.*)$/.exec(String(key || ""))
  return match ? { topic: match[1], field: match[2] } : null
}

/**
 * Apply the final-review walk to cloned intake and document-plan data.
 * Choice 0 fills/adds; choice 1 deliberately removes the referenced project
 * datum (except a missing header, where it means leave blank).
 */
export function applyReviewAnswers(input, answers) {
  const source = input && typeof input === "object" ? input : {}
  let hdr = clone(source.hdr, {})
  let parts = clone(source.parts, [])
  let designs = clone(source.designs, [])
  let plan = clone(source.plan, { pages: [] })
  if (!Array.isArray(plan.pages)) plan.pages = []
  const affected = new Set()
  const removed = new Set()
  const changes = []

  for (const answer of Array.isArray(answers) ? answers : []) {
    const parsed = parseAnswerKey(answer && answer.key)
    if (!parsed) continue
    const { topic, field } = parsed
    const add = Number(answer.choice) === 0
    const value = typeof answer.value === "string" ? answer.value.trim() : ""

    if (topic === "header") {
      if (add && value) {
        hdr[field] = value
        changes.push({ action: "updated", topic, field, value })
      }
      continue
    }

    if (topic === "part") {
      const bom = fullBomPage(plan.pages)
      if (bom && bom.id) affected.add(bom.id)
      if (add) {
        changes.push({ action: "placed", topic, field })
      } else {
        const before = parts.length
        parts = parts.filter((part) => !sameText(part && part.id, field))
        if (parts.length !== before) changes.push({ action: "removed", topic, field })
      }
      continue
    }

    const designIndex = designs.findIndex((design) => sameText(design && design.name, field))
    const designPage = plan.pages.find((page) => sameText(designPageName(page), field))

    if (topic === "design") {
      if (add) {
        if (designPage && designPage.id) affected.add(designPage.id)
        changes.push({ action: "placed", topic, field })
      } else {
        designs = designs.filter((design) => !sameText(design && design.name, field))
        let pageRemoved = false
        plan.pages = plan.pages.filter((page) => {
          if (!sameText(designPageName(page), field)) return true
          if (page.id) removed.add(page.id)
          pageRemoved = true
          return false
        })
        if (designIndex >= 0 || pageRemoved) changes.push({ action: "removed", topic, field })
      }
      continue
    }

    if (designIndex < 0) continue
    if (designPage && designPage.id) affected.add(designPage.id)

    if (topic === "design-colors") {
      if (add) changes.push({ action: "placed", topic, field })
      else {
        designs[designIndex].colors = []
        changes.push({ action: "removed", topic, field })
      }
    } else if (topic === "design-emb") {
      if (add) changes.push({ action: "placed", topic, field })
      else {
        designs[designIndex].emb = clone(EMPTY_EMB, {})
        changes.push({ action: "removed", topic, field })
      }
    }
  }

  const contractCtx = {
    garmentType: hdr.pname || "Tech Pack",
    hdr,
    parts,
    designs,
  }
  const beforeIds = new Set(((plan && plan.pages) || []).map((page) => page && page.id).filter(Boolean))
  plan = repairOutline(plan, contractCtx).outline

  plan.pages = plan.pages.map((page) => {
    const before = clone(page, {})
    const repaired = repairPage(page, contractCtx).page
    if (!beforeIds.has(repaired.id) || JSON.stringify(before.regions || []) !== JSON.stringify(repaired.regions || [])) {
      if (repaired.id) affected.add(repaired.id)
    }
    return repaired
  })

  // A newly inserted overview is the destination for every part-placement fix.
  const repairedBom = fullBomPage(plan.pages)
  if (repairedBom && !beforeIds.has(repairedBom.id)) affected.add(repairedBom.id)

  return {
    hdr,
    parts,
    designs,
    plan,
    affectedPageIds: [...affected],
    removedPageIds: [...removed],
    changes,
  }
}

export { parseAnswerKey }
