// A small, dependency-free flexbox-*like* solver for laying out tech pack
// pages. It mirrors CSS flexbox's core idea (a node is a flex ITEM relative
// to its parent's main axis, and a flex CONTAINER for its own children) but
// only implements the single-pass subset this project actually needs:
// row/column direction, grow/shrink/basis/min/max sizing, gap, padding,
// stretch|start|center|end alignment on the cross axis, and
// start|center|end|space-between justification on the main axis.
//
// Sizing values (basis, min, max, gap, padding) may be given as a number of
// px OR as a percentage string like "6%". Percentages resolve against the
// container's main-axis size (for basis/min/max/gap) or the matching axis
// (for padding sides) — this is how the design system expresses the
// "márgenes por porcentaje entre retículas": the gutters between major grid
// blocks scale proportionally with the format instead of being fixed px.
//
// Clamped children DO give space back: grow/shrink run the classic flexbox
// multi-pass loop - a child that hits max (growing) or min (shrinking) is
// frozen at its clamp and the leftover re-distributes among its unfrozen
// siblings on the next pass (see "solveLayout redistribution" tests).

const AUTO = "auto"

// Resolve a length that may be a number (px), a "N%" string (percent of
// `basis`), or undefined -> fallback.
export function resolveLen(value, basis, fallback = 0) {
  if (value === undefined || value === null || value === AUTO) return fallback
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim().endsWith("%")) {
    return (parseFloat(value) / 100) * basis
  }
  return parseFloat(value) || fallback
}

function box(padding, width, height) {
  if (padding === undefined || padding === null) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof padding === "number" || typeof padding === "string") {
    return {
      top: resolveLen(padding, height),
      right: resolveLen(padding, width),
      bottom: resolveLen(padding, height),
      left: resolveLen(padding, width),
    }
  }
  return {
    top: resolveLen(padding.top, height),
    right: resolveLen(padding.right, width),
    bottom: resolveLen(padding.bottom, height),
    left: resolveLen(padding.left, width),
  }
}

function mainAxis(direction) {
  return direction === "column" ? "height" : "width"
}
function crossAxis(direction) {
  return direction === "column" ? "width" : "height"
}
function mainPos(direction) {
  return direction === "column" ? "y" : "x"
}
function crossPos(direction) {
  return direction === "column" ? "x" : "y"
}

/**
 * Resolve a region tree into absolute boxes.
 * @param {object} node - see src/layout/builders.js for the shape.
 * @param {{x?:number,y?:number,width:number,height:number}} outer - the box this node must fill.
 * @returns {object} the same tree shape, with x/y/width/height added on every node.
 */
export function solveLayout(node, outer) {
  const x = outer.x || 0
  const y = outer.y || 0
  const width = outer.width
  const height = outer.height
  const resolved = { ...node, x, y, width, height }

  if (!node.children || node.children.length === 0) return resolved

  const direction = node.direction || "row"
  const pad = box(node.padding, width, height)
  const mAxis = mainAxis(direction)
  const cAxis = crossAxis(direction)
  const mPos = mainPos(direction)
  const cPos = crossPos(direction)

  // Full main-axis size of this container — the reference for resolving any
  // percentage basis/gap/min/max of its children.
  const mainDim = direction === "column" ? height : width
  const gap = resolveLen(node.gap, mainDim, 0)

  const innerMain = (direction === "column" ? height - pad.top - pad.bottom : width - pad.left - pad.right)
  const innerCross = (direction === "column" ? width - pad.left - pad.right : height - pad.top - pad.bottom)
  const innerMainStart = direction === "column" ? y + pad.top : x + pad.left
  const innerCrossStart = direction === "column" ? x + pad.left : y + pad.top

  const children = node.children
  const n = children.length
  const totalGap = gap * Math.max(0, n - 1)
  const availableForBasis = innerMain - totalGap

  const minOf = (c) => resolveLen(c.min, mainDim, 0)
  const maxOf = (c) => (c.max === undefined ? Infinity : resolveLen(c.max, mainDim, Infinity))

  const bases = children.map((c) => {
    const b = resolveLen(c.basis, mainDim, 0)
    return Math.min(Math.max(b, minOf(c)), maxOf(c))
  })
  const usedBasis = bases.reduce((a, b) => a + b, 0)
  const remaining = availableForBasis - usedBasis

  // Multi-pass grow/shrink (the classic flexbox loop): a child that clamps
  // against max (growing) or min (shrinking) is FROZEN at its clamp and only
  // the space it actually consumed leaves the pool - the rest re-distributes
  // among the unfrozen participants on the next pass, instead of being lost
  // (which used to pool as blank space at the end of the container). Bounded
  // by children.length passes; each pass either freezes someone or settles.
  const mainSizes = bases.slice()
  const shrinkWeight = (c, i) => (c.shrink === undefined ? 1 : c.shrink) * bases[i]
  if (remaining > 0) {
    const frozen = children.map((c) => (c.grow || 0) <= 0)
    let pool = remaining
    for (let pass = 0; pass < children.length; pass++) {
      let activeGrow = 0
      for (let i = 0; i < children.length; i++) if (!frozen[i]) activeGrow += children[i].grow || 0
      if (activeGrow <= 0 || pool <= 1e-9) break
      let clampedThisPass = false
      let consumedByClamped = 0
      for (let i = 0; i < children.length; i++) {
        if (frozen[i]) continue
        const candidate = mainSizes[i] + pool * ((children[i].grow || 0) / activeGrow)
        const max = maxOf(children[i])
        if (candidate >= max) {
          consumedByClamped += max - mainSizes[i]
          mainSizes[i] = max
          frozen[i] = true
          clampedThisPass = true
        }
      }
      if (!clampedThisPass) {
        for (let i = 0; i < children.length; i++) {
          if (!frozen[i]) mainSizes[i] += pool * ((children[i].grow || 0) / activeGrow)
        }
        break
      }
      pool -= consumedByClamped
    }
  } else if (remaining < 0) {
    const frozen = children.map((c, i) => shrinkWeight(c, i) <= 0)
    let pool = -remaining // amount that must be removed
    for (let pass = 0; pass < children.length; pass++) {
      let activeWeight = 0
      for (let i = 0; i < children.length; i++) if (!frozen[i]) activeWeight += shrinkWeight(children[i], i)
      if (activeWeight <= 0 || pool <= 1e-9) break
      let clampedThisPass = false
      let removedByClamped = 0
      for (let i = 0; i < children.length; i++) {
        if (frozen[i]) continue
        const candidate = mainSizes[i] - pool * (shrinkWeight(children[i], i) / activeWeight)
        const min = minOf(children[i])
        if (candidate <= min) {
          removedByClamped += mainSizes[i] - min
          mainSizes[i] = min
          frozen[i] = true
          clampedThisPass = true
        }
      }
      if (!clampedThisPass) {
        for (let i = 0; i < children.length; i++) {
          if (!frozen[i]) mainSizes[i] -= pool * (shrinkWeight(children[i], i) / activeWeight)
        }
        break
      }
      pool -= removedByClamped
    }
  }

  const justify = node.justify || "start"
  const usedMain = mainSizes.reduce((a, b) => a + b, 0) + totalGap
  const freeSpace = Math.max(0, innerMain - usedMain)
  let cursor = innerMainStart
  let gapExtra = gap
  if (justify === "center") cursor += freeSpace / 2
  else if (justify === "end") cursor += freeSpace
  else if (justify === "space-between" && n > 1) gapExtra = gap + freeSpace / (n - 1)

  const align = node.align || "stretch"

  resolved.children = children.map((child, i) => {
    const mSize = mainSizes[i]
    let cSize
    let cOffset = innerCrossStart
    if (align === "stretch" || child.crossBasis === undefined) {
      cSize = align === "stretch" ? innerCross : (child.crossBasis !== undefined ? resolveLen(child.crossBasis, innerCross) : innerCross)
    } else {
      cSize = resolveLen(child.crossBasis, innerCross)
    }
    if (align === "center") cOffset = innerCrossStart + (innerCross - cSize) / 2
    else if (align === "end") cOffset = innerCrossStart + (innerCross - cSize)

    // Snap each child box to whole pixels, EDGE-wise: round the start and end
    // coordinates independently and derive the size from them, so adjacent
    // children still share exactly one edge (rounding position and size
    // separately would open 1px gaps / overlaps). The fractional cursor keeps
    // accumulating unrounded so rounding error never drifts down a long run
    // of siblings. Whole-pixel boxes are what keep hairline rules crisp and
    // make edges from DIFFERENT blocks actually coincide on the page.
    const childOuter = {
      [mPos]: Math.round(cursor),
      [cPos]: Math.round(cOffset),
      [mAxis]: Math.round(cursor + mSize) - Math.round(cursor),
      [cAxis]: Math.round(cOffset + cSize) - Math.round(cOffset),
    }
    cursor += mSize + gapExtra
    return solveLayout(child, childOuter)
  })

  return resolved
}
