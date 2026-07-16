import { describe, it, expect } from "vitest"
import { solveLayout, resolveLen } from "./solve.js"
import { row, col, leaf } from "./builders.js"

describe("solveLayout", () => {
  it("gives a childless leaf the full outer box", () => {
    const tree = leaf({})
    const resolved = solveLayout(tree, { x: 10, y: 20, width: 100, height: 50 })
    expect(resolved).toMatchObject({ x: 10, y: 20, width: 100, height: 50 })
  })

  it("splits a row evenly between equal-grow children", () => {
    const tree = row({}, [leaf({ grow: 1 }), leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 200, height: 50 })
    expect(resolved.children[0].width).toBe(100)
    expect(resolved.children[1].width).toBe(100)
    expect(resolved.children[0].x).toBe(0)
    expect(resolved.children[1].x).toBe(100)
  })

  it("gives remaining space to a grow child after fixed-basis siblings", () => {
    const tree = row({}, [leaf({ basis: 88 }), leaf({ grow: 1 }), leaf({ basis: 100 })])
    const resolved = solveLayout(tree, { width: 500, height: 50 })
    expect(resolved.children[0].width).toBe(88)
    expect(resolved.children[2].width).toBe(100)
    expect(resolved.children[1].width).toBe(500 - 88 - 100)
    expect(resolved.children[1].x).toBe(88)
    expect(resolved.children[2].x).toBe(88 + (500 - 88 - 100))
  })

  it("shrinks children proportionally to basis*shrink when content overflows", () => {
    // two children, basis 300 and 300, container only 400 wide -> both shrink=1
    // by default, so both should shrink by the same proportion of their basis.
    const tree = row({}, [leaf({ basis: 300 }), leaf({ basis: 300 })])
    const resolved = solveLayout(tree, { width: 400, height: 50 })
    expect(resolved.children[0].width).toBe(200)
    expect(resolved.children[1].width).toBe(200)
  })

  it("does not shrink a child with shrink:0", () => {
    const tree = row({}, [leaf({ basis: 300, shrink: 0 }), leaf({ basis: 300 })])
    const resolved = solveLayout(tree, { width: 400, height: 50 })
    expect(resolved.children[0].width).toBe(300)
    expect(resolved.children[1].width).toBe(100)
  })

  it("clamps a growing child to its max", () => {
    const tree = row({}, [leaf({ grow: 1, max: 60 }), leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 200, height: 50 })
    expect(resolved.children[0].width).toBe(60)
    // the extra space beyond the clamped child's max is NOT redistributed in
    // this simplified solver - documented in solve.js. The second child only
    // gets its share of the original `remaining` pool.
    expect(resolved.children[1].width).toBe(100)
  })

  it("clamps a growing child to its min even with no free space", () => {
    const tree = row({}, [leaf({ basis: 190, min: 50 }), leaf({ basis: 190, min: 50 })])
    const resolved = solveLayout(tree, { width: 100, height: 50 })
    expect(resolved.children[0].width).toBeGreaterThanOrEqual(50)
    expect(resolved.children[1].width).toBeGreaterThanOrEqual(50)
  })

  it("applies padding and gap", () => {
    const tree = row({ padding: 10, gap: 20 }, [leaf({ grow: 1 }), leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 220, height: 100 })
    // inner main = 220 - 20 (padding l+r) - 20 (gap) = 180, split evenly = 90 each
    expect(resolved.children[0].width).toBe(90)
    expect(resolved.children[1].width).toBe(90)
    expect(resolved.children[0].x).toBe(10)
    expect(resolved.children[1].x).toBe(10 + 90 + 20)
    // cross axis (height) respects top/bottom padding under default stretch align
    expect(resolved.children[0].height).toBe(80)
    expect(resolved.children[0].y).toBe(10)
  })

  it("lays out nested row-in-column correctly", () => {
    const tree = col({}, [
      leaf({ basis: 30 }),
      row({ grow: 1 }, [leaf({ grow: 1 }), leaf({ grow: 1 })]),
    ])
    const resolved = solveLayout(tree, { width: 100, height: 130 })
    const [header, body] = resolved.children
    expect(header.height).toBe(30)
    expect(body.height).toBe(100)
    expect(body.y).toBe(30)
    expect(body.children[0].width).toBe(50)
    expect(body.children[1].x).toBe(50)
  })

  it("centers children with justify:center and no grow", () => {
    const tree = row({ justify: "center" }, [leaf({ basis: 40 }), leaf({ basis: 40 })])
    const resolved = solveLayout(tree, { width: 200, height: 50 })
    // free space = 200-80=120, centered -> starts at 60
    expect(resolved.children[0].x).toBe(60)
    expect(resolved.children[1].x).toBe(100)
  })

  it("distributes free space with justify:space-between", () => {
    const tree = row({ justify: "space-between" }, [leaf({ basis: 20 }), leaf({ basis: 20 }), leaf({ basis: 20 })])
    const resolved = solveLayout(tree, { width: 200, height: 50 })
    expect(resolved.children[0].x).toBe(0)
    expect(resolved.children[2].x).toBe(180)
    // middle child sits exactly between the two gaps
    const gap = resolved.children[1].x - (resolved.children[0].x + 20)
    const gap2 = resolved.children[2].x - (resolved.children[1].x + 20)
    expect(gap).toBeCloseTo(gap2, 5)
  })

  it("stretches children across the cross axis by default", () => {
    const tree = row({}, [leaf({ grow: 1 }), leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 100, height: 77 })
    expect(resolved.children[0].height).toBe(77)
    expect(resolved.children[1].height).toBe(77)
  })

  it("honors explicit crossBasis with align:start instead of stretching", () => {
    const tree = row({ align: "start" }, [leaf({ grow: 1, crossBasis: 20 })])
    const resolved = solveLayout(tree, { width: 100, height: 80 })
    expect(resolved.children[0].height).toBe(20)
    expect(resolved.children[0].y).toBe(0)
  })

  it("centers a child on the cross axis with align:center", () => {
    const tree = row({ align: "center" }, [leaf({ grow: 1, crossBasis: 20 })])
    const resolved = solveLayout(tree, { width: 100, height: 80 })
    expect(resolved.children[0].y).toBe(30)
  })

  it("calls render() with the resolved box on leaves", () => {
    let received = null
    const tree = row({}, [leaf({ grow: 1, render: (b) => { received = b; return "<rect/>" } })])
    solveLayout(tree, { width: 100, height: 40 })
    // solveLayout itself doesn't call render - that's renderLayoutToSVG's job.
    expect(received).toBe(null)
  })

  it("resolveLen handles px numbers, percent strings, and fallbacks", () => {
    expect(resolveLen(40, 200)).toBe(40)
    expect(resolveLen("10%", 200)).toBe(20)
    expect(resolveLen("6%", 1200)).toBe(72)
    expect(resolveLen(undefined, 200, 5)).toBe(5)
    expect(resolveLen("auto", 200, 7)).toBe(7)
  })

  it("resolves a percentage basis against the container main axis", () => {
    const tree = row({}, [leaf({ basis: "25%" }), leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 400, height: 50 })
    expect(resolved.children[0].width).toBe(100) // 25% of 400
    expect(resolved.children[1].width).toBe(300)
  })

  it("resolves percentage gaps as margins between retículas", () => {
    // "márgenes por porcentaje entre las retículas": a 10% gutter between two
    // equal blocks on a 500px-wide row -> 50px gutter, 225px each.
    const tree = row({ gap: "10%" }, [leaf({ grow: 1 }), leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 500, height: 50 })
    expect(resolved.children[0].width).toBe(225)
    expect(resolved.children[1].width).toBe(225)
    expect(resolved.children[1].x).toBe(225 + 50)
  })

  it("resolves percentage padding per axis", () => {
    const tree = col({ padding: "10%" }, [leaf({ grow: 1 })])
    const resolved = solveLayout(tree, { width: 200, height: 400 })
    // left/right padding = 10% of width (20), top/bottom = 10% of height (40)
    expect(resolved.children[0].x).toBe(20)
    expect(resolved.children[0].y).toBe(40)
    expect(resolved.children[0].width).toBe(160)
    expect(resolved.children[0].height).toBe(320)
  })

  it("flexes row heights by data volume - the whole point of this engine", () => {
    // This is the property the fixed-coordinate cap page used to compute by
    // hand (Math.floor(bodyH / partsCount)). Prove the generic engine gives
    // the same kind of answer for N and for N+3 rows without any special-casing.
    const buildRows = (n) => col({}, Array.from({ length: n }, () => leaf({ grow: 1, min: 16 })))

    const five = solveLayout(buildRows(5), { width: 300, height: 300 })
    expect(five.children).toHaveLength(5)
    expect(five.children[0].height).toBe(60)

    // 300/8 = 37.5 - boxes snap to whole pixels EDGE-wise (rounding start and
    // end coordinates, size derived from them), so rows alternate 38/37 while
    // adjacent rows still share exactly one edge and the total is preserved.
    const eight = solveLayout(buildRows(8), { width: 300, height: 300 })
    expect(eight.children).toHaveLength(8)
    eight.children.forEach((c) => {
      expect(Number.isInteger(c.y)).toBe(true)
      expect(Number.isInteger(c.height)).toBe(true)
      expect([37, 38]).toContain(c.height)
    })
    expect(eight.children.reduce((a, c) => a + c.height, 0)).toBe(300)
    // no gaps/overlaps: each row starts exactly where the previous ended
    for (let i = 1; i < eight.children.length; i++) {
      expect(eight.children[i].y).toBe(eight.children[i - 1].y + eight.children[i - 1].height)
    }
  })
})
