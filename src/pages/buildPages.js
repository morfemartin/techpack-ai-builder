import { T } from "../core/i18n.js"
import { NA, sv, R, TX, LBL, VAL, dimLine, svgChip, svgHeader, svgDisc, svgSectionBar, wrapLines, fitText } from "../core/svgPrimitives.js"
import { h2c } from "../core/colorUtils.js"
import { isEmbTec, isWholePosF } from "../core/helpers.js"
import { row, col, leaf, solveLayout, renderLayoutToSVG } from "../layout/index.js"
import { palette, type } from "../design/tokens.js"
import { COL, CHIP, INSET, ROW, TEXT_PAD } from "../design/metrics.js"
import { briefLines } from "./briefs.js"
import { GENERIC_SILHOUETTE } from "../garments/genericSilhouette.js"

export function renderPartsList(box, { parts, partLabels, txParts, labels, compact, startIndex } = {}) {
  var safeParts = Array.isArray(parts) ? parts.filter(function (p) { return p && p.on !== false }) : []
  var pn = partLabels || {}
  var txP = Array.isArray(txParts) ? txParts : null
  var lx = labels || {}
  // The chip number continues from `startIndex` - what lets a "cont." page
  // (see interpretPlan.js's pagination) number its rows 16, 17, 18... instead
  // of restarting at 1, so a split BOM still reads as one continuous list.
  var start = Number(startIndex) || 0
  // `compact` (used by the AI-planned pages): fixed, tight row height, top-
  // aligned, so a short parts list reads as a clean table with breathing room
  // instead of a few rows stretched tall with tiny text floating in huge cells.
  // The registered Cap keeps the default flex-fill rows (grow:1) untouched.
  var rowSizing = compact ? { basis: ROW.table, grow: 0, min: 24 } : { grow: 1, min: 16 }

  // Header and data rows share the SAME column template (metrics.js COL) and
  // the same alignment - the old header centered its captions at unrelated
  // stops (0.32/0.62) and even claimed a 4th "Archivo / Drive" column that no
  // data row ever drew. Dividers and the text beside them are both rounded so
  // rule and glyph can't drift apart by sub-pixel amounts.
  function colStops(b) {
    return { divLabel: Math.round(b.x + b.width * COL.label), divValue: Math.round(b.x + b.width * COL.value) }
  }

  var tableHeaderRow = leaf({
    basis: ROW.tableHeader,
    render: (b) => {
      var st = colStops(b)
      return (
        R(b.x, b.y, b.width, b.height, "#EDEEF0", palette.ink.hex, "0.6") +
        TX(b.x + b.width * COL.index, b.y + b.height / 2, "#", 8, true, "middle") +
        TX(st.divLabel + TEXT_PAD, b.y + b.height / 2, lx.spec || "SPECS", 8, true, "start") +
        TX(st.divValue + TEXT_PAD, b.y + b.height / 2, lx.detail || "DETAILS", 8, true, "start")
      )
    },
  })

  var partRows = safeParts.map((p, i) =>
    leaf({
      ...rowSizing,
      render: (b) => {
        var bg = i % 2 === 0 ? palette.white.hex : "#F7F7F8"
        var nm = pn[p.id] || p.customName || "P" + p.id
        var v = txP ? txP[i] : p.val
        var st = colStops(b)
        return (
          R(b.x, b.y, b.width, b.height, bg, "#ccc", "0.4") +
          // role.index chip: shared mark via svgChip - same size everywhere.
          svgChip(b.x + b.width * COL.index, b.y + b.height / 2, start + i + 1, Math.min(b.height - 6, CHIP)) +
          "<line x1='" + st.divLabel + "' y1='" + b.y + "' x2='" + st.divLabel + "' y2='" + (b.y + b.height) + "' stroke='#ddd' stroke-width='0.5'/>" +
          TX(st.divLabel + TEXT_PAD, b.y + b.height / 2, nm, 7, false, "start") +
          "<line x1='" + st.divValue + "' y1='" + b.y + "' x2='" + st.divValue + "' y2='" + (b.y + b.height) + "' stroke='#ddd' stroke-width='0.5'/>" +
          TX(st.divValue + TEXT_PAD, b.y + b.height / 2, v || NA, 7, false, "start", undefined, type.svgFonts.data)
        )
      },
    })
  )

  return renderLayoutToSVG(solveLayout(col({}, [tableHeaderRow, ...partRows]), box))
}

// How tall each color row gets: as close to the ideal ROW.color as the
// available height allows, but NEVER so short a row gets dropped - a
// saturated color list shrinks its rows (down to a still-legible floor)
// instead of silently losing entries past some cutoff, matching every other
// "never truncate, shrink instead" rule in this file.
function colorRowHeight(count, availH) {
  if (count <= 0) return ROW.color
  return Math.max(16, Math.min(ROW.color, Math.floor(availH / count)))
}

// Vertical gap between a block's top rule and its section bar.
var SECTION_RULE_GAP = 6

export function renderColorSpecs(box, { colors } = {}) {
  var s = ""
  var ty = box.y
  var W = box.width
  var limitY = box.y + box.height
  var safe = (colors || []).filter(function (c) { return c && c.hex })

  // Full-width rule + full-width section bar (svgSectionBar): the same edges
  // and left-aligned title grammar as the page titleBar, instead of the old
  // 10px-inset centered bar that never lined up with anything else.
  s += "<line x1='" + box.x + "' y1='" + ty + "' x2='" + (box.x + W) + "' y2='" + ty + "' stroke='#ddd' stroke-width='1'/>"
  ty += SECTION_RULE_GAP
  s += svgSectionBar(box.x, ty, W, "PANTONE / CMYK")
  ty += 20 + SECTION_RULE_GAP
  var rowH = colorRowHeight(safe.length, limitY - ty)
  var swatch = Math.min(20, rowH - 4)
  // A color card may be intentionally composed as a narrow data column next
  // to the illustration and embroidery sheet. In that shape the full CMYK
  // sentence would cross into its neighbour even when the row is tall, so
  // compact by available width as well as by row height.
  var small = rowH < 26 || W < 260
  var textX = box.x + INSET + swatch + TEXT_PAD * 2
  safe.forEach(function (col) {
    var cm = h2c(col.hex)
    var rowMidY = ty + rowH / 2
    s += R(box.x + INSET, rowMidY - swatch / 2, swatch, swatch, col.hex, palette.ink.hex, "0.5")
    if (small) {
      s += TX(textX, rowMidY, (col.name || col.hex) + "  " + col.hex, 7.5, true, "start")
    } else {
      s += TX(textX, rowMidY - 6, col.name || col.hex, 8, true, "start")
      s += TX(textX, rowMidY + 6, "C:" + cm.c + " M:" + cm.m + " Y:" + cm.y + " K:" + cm.k + " | " + col.hex, 7, false, "start", undefined, type.svgFonts.data)
    }
    ty += rowH
  })
  return s
}

function colorSpecsHeight(colors, startY, limitY) {
  var safe = (colors || []).filter(function (c) { return c && c.hex })
  var headH = SECTION_RULE_GAP * 2 + 20
  var rowH = colorRowHeight(safe.length, limitY - startY - headH)
  return headH + safe.length * rowH
}

export function renderEmbSpecs(box, { emb, title } = {}) {
  if (!emb) return ""
  var s = ""
  var ef = emb
  var ty = box.y
  var W = box.width
  var limitY = box.y + box.height

  // Same full-width rule + section-bar grammar as renderColorSpecs, and the
  // value column sits on the shared COL.value stop - stacked blocks now share
  // their vertical alignment instead of each picking its own (0.55 vs 0.5).
  s += "<line x1='" + box.x + "' y1='" + ty + "' x2='" + (box.x + W) + "' y2='" + ty + "' stroke='#ddd' stroke-width='1'/>"
  ty += SECTION_RULE_GAP
  s += svgSectionBar(box.x, ty, W, title || "Embroidery Tech Sheet")
  ty += 20 + SECTION_RULE_GAP + 6
  var valueX = Math.round(box.x + W * COL.value) + TEXT_PAD
  var er = [["Formato", ef.machine], ["Puntadas", ef.stitches], ["Cambios color", ef.colorChanges], ["Paradas/Cortes", ef.stops + "/" + ef.trims], ["Tela", ef.fabric], ["Estab.Top", ef.stabTopping], ["Estab.Backing", ef.stabBacking], ["Dimension", ef.w && ef.h ? (ef.w + "x" + ef.h + " mm") : NA], ["Area", ef.area ? (ef.area + " mm2") : NA], ["Max puntada", ef.maxStitch ? (ef.maxStitch + " mm") : NA], ["Min puntada", ef.minStitch ? (ef.minStitch + " mm") : NA], ["Max salto", ef.maxJump ? (ef.maxJump + " mm") : NA], ["Hilo", ef.totalThread], ["Bobina", ef.totalBobbin]]
  var seq = ef.stopSeq && ef.stopSeq.length > 0 ? ef.stopSeq : []
  // Same "never drop a row, shrink instead" rule as colorSpecs: count every
  // row this block WILL draw (fields + optional sequence header/rows) and fit
  // them all into the available height rather than cutting off at some fixed
  // line height once the box is smaller than expected.
  var totalRows = er.length + (seq.length > 0 ? 1 + seq.length : 0)
  var rowH = Math.max(11, Math.min(ROW.emb, Math.floor((limitY - ty) / Math.max(1, totalRows))))
  var fontSize = Math.max(6.5, Math.min(8, rowH - 6))
  er.forEach(function (row) {
    s += TX(box.x + INSET, ty, row[0] + ":", fontSize, true, "start") + TX(valueX, ty, row[1] || NA, fontSize, false, "start", undefined, type.svgFonts.data)
    ty += rowH
  })
  if (seq.length > 0) {
    ty += Math.max(0, rowH - 12)
    s += "<line x1='" + box.x + "' y1='" + ty + "' x2='" + (box.x + W) + "' y2='" + ty + "' stroke='#eee' stroke-width='0.8'/>"
    ty += rowH
    s += TX(box.x + INSET, ty, "Secuencia:", fontSize, true, "start")
    ty += rowH
    seq.forEach(function (st) {
      s += TX(box.x + INSET + TEXT_PAD, ty, "Stop " + st.stop + ": " + st.name + " (" + st.stitches + " pt.)", fontSize, false, "start", undefined, type.svgFonts.data)
      ty += rowH
    })
  }
  return s
}

export function renderIllustrationZone(box, { slots, refs, note, briefs } = {}) {
  var slotCount = Math.max(1, Number(slots) || (Array.isArray(refs) ? refs.length : 1))
  var noteText = note || ""
  // The illustration is the hero: it takes the WHOLE box (no note band carved
  // out). The illustrator brief lives INSIDE the primary art board, muted,
  // exactly where the drawing goes - so it's replaced in place with nothing to
  // re-flow, and it costs zero extra layout height.
  var cols = Math.ceil(Math.sqrt(slotCount))
  var rows = Math.ceil(slotCount / cols)
  var gap = 12
  var cellW = (box.width - gap * (cols + 1)) / cols
  var cellH = (box.height - gap * (rows + 1)) / rows
  var s = ""

  for (var i = 0; i < slotCount; i++) {
    var c = i % cols
    var r = Math.floor(i / cols)
    var x = box.x + gap + c * (cellW + gap)
    var y = box.y + gap + r * (cellH + gap)
    var refLabel = Array.isArray(refs) && refs[i] ? String(refs[i]) : "Vista " + (i + 1)
    // Crop-marked art board: a hairline frame with inward corner registration
    // ticks reads as "place artwork here", not a blank box.
    s += R(x, y, cellW, cellH, "none", "#E4E6EA", "0.8")
    var tk = 12
    ;[[x, y, 1, 1], [x + cellW, y, -1, 1], [x, y + cellH, 1, -1], [x + cellW, y + cellH, -1, -1]].forEach(function (p) {
      s += "<line x1='" + p[0] + "' y1='" + p[1] + "' x2='" + (p[0] + tk * p[2]) + "' y2='" + p[1] + "' stroke='#B7BCC6' stroke-width='1'/>"
      s += "<line x1='" + p[0] + "' y1='" + p[1] + "' x2='" + p[0] + "' y2='" + (p[1] + tk * p[3]) + "' stroke='#B7BCC6' stroke-width='1'/>"
    })
    // Red index chip + uppercase view label, top-left (the tech-pack "FRONT
    // VIEW" / "BACK VIEW" caption). The chip stays the cell's only attention mark.
    s += svgChip(x + 8 + CHIP / 2, y + 8 + CHIP / 2, i + 1)
    s += TX(x + 8 + CHIP + 8, y + 8 + CHIP / 2, String(refLabel).toUpperCase(), 9, true, "start", palette.ink.hex)

    var innerW = Math.max(40, cellW - 44)
    var innerH = cellH * 0.6

    var brief = Array.isArray(briefs) && briefs[i] ? briefs[i] : null
    if (brief) {
      // Structured per-slot brief: pick the richest template mode whose
      // wrapped lines actually fit this cell (full → checklist → title) -
      // the degradation ladder means EVERY slot explains itself legibly,
      // however small the grid makes its cell. Slot 0 also appends the AI's
      // narrative note below the structured skeleton when there is one.
      var body = null
      var modes = ["full", "checklist", "title"]
      for (var mi = 0; mi < modes.length; mi++) {
        var candidate = briefLines(brief, modes[mi])
        if (i === 0 && noteText && modes[mi] !== "title") candidate = candidate.concat([noteText])
        var wrapped = []
        candidate.forEach(function (line) {
          wrapped = wrapped.concat(wrapLines(line, innerW, 9.5))
        })
        if (wrapped.length * 13 <= innerH || modes[mi] === "title") {
          body = wrapped.slice(0, Math.max(2, Math.floor(innerH / 13)))
          break
        }
      }
      var by0 = y + cellH / 2 - (body.length * 13) / 2 + 6
      s += TX(x + cellW / 2, by0 - 13 - 4, "BRIEF PARA EL ILUSTRADOR", 8, true, "middle", "#9AA0AB")
      body.forEach(function (line, li) {
        s += TX(x + cellW / 2, by0 + li * 13, line, 9.5, li === 0, "middle", "#9AA0AB")
      })
    } else if (i === 0 && noteText) {
      // Legacy path (registered garments / plans without structured briefs):
      // fitText shrinks the narrative brief until it fits the primary cell.
      var fit = fitText(noteText, innerW, innerH, { maxSize: 11, minSize: 7.5 })
      var startY = y + cellH / 2 - (fit.lines.length * fit.lineHeight) / 2 + fit.lineHeight / 2
      s += TX(x + cellW / 2, startY - fit.lineHeight - 6, "BRIEF PARA EL ILUSTRADOR", 8, true, "middle", "#9AA0AB")
      fit.lines.forEach(function (line, li) {
        s += TX(x + cellW / 2, startY + li * fit.lineHeight, line, fit.size, false, "middle", "#9AA0AB")
      })
    }
  }

  return s
}

/* ---- PAGE 1: parts spec sheet + 4-view diagram (garment-specific) ----
 * Built on the flexbox-style layout engine (src/layout/) instead of hand-computed
 * pixel math. The spec-table row heights in particular used to be a manual
 * `Math.floor(bodyH / partsCount)` formula that had to be re-derived any time the
 * page geometry changed - now every row is just `leaf({ grow: 1, min: 16 })` and
 * the solver distributes the available height across however many parts are
 * active. That's the "flex by data volume" property the engine exists for.
 */
export function buildPage1(lang, hdr, parts, logo, txData, garment) {
  var t = T[lang] || T.ES
  var pn = garment.partLabels[lang] || garment.partLabels.ES
  // discH: just enough for svgDisc's single centered 9px line + breathing
  // room - was 28, oversized for one line of text regardless of page content.
  var W = 1200, H = 900, hH = 80, discH = 20
  var lW = 320
  var ap = parts.filter(function (p) { return p.on })
  var txP = txData && txData.parts ? txData.parts : null

  var headerLeaf = leaf({
    basis: hH,
    render: (b) => "<g transform='translate(" + b.x + " " + b.y + ")'>" + svgHeader(hdr, logo, b.width, b.height) + "</g>",
  })

  var detailsBar = leaf({
    basis: 22,
    // role.priority: a section header bar spanning the page - solid blue, white text.
    render: (b) => R(b.x, b.y, b.width, b.height, palette.blue.hex, palette.ink.hex, "0.8") + TX(b.x + b.width / 2, b.y + b.height / 2, "DETAILS", 11, true, "middle", palette.white.hex),
  })

  var specTable = leaf({
    basis: lW,
    render: (b) => renderPartsList(b, { parts: ap, partLabels: pn, txParts: txP, labels: { spec: t.sp, detail: t.dt } }),
  })

  function buildViewCell(vi) {
    return leaf({
      grow: 1,
      render: (b) => {
        var s = R(b.x, b.y, b.width, b.height, "white", "#aaa", "0.8")
        s += TX(b.x + b.width / 2, b.y + 14, t.vw[vi], 11, true, "middle")
        var ox = b.x + (b.width - 200) / 2, oy = b.y + 22
        var guidePath = garment.guides ? garment.guides[vi] : GENERIC_SILHOUETTE
        s += "<g transform='translate(" + ox + " " + oy + ")'><path d='" + guidePath + "' fill='none' stroke='#ccc' stroke-width='1' stroke-dasharray='5,3'/></g>"
        // No hand-drawn callouts for a garment without real guides (e.g. an
        // AI-drafted "prenda desde 0") - inventing pointer coordinates would
        // misrepresent data we don't have. The numbered parts table above
        // still carries the same red index chips either way.
        ;(garment.callouts ? garment.callouts[vi] : []).forEach((co) => {
          var pid = co[0], tx2 = co[1], ty2 = co[2], cx2 = co[3], cy2 = co[4]
          var ri = ap.findIndex((a) => a.id === pid)
          if (ri < 0) return
          // role.index: solid red badge + white mono number - same "found first"
          // enumeration mark as the part-row chips, cross-referenced by number.
          s += "<line x1='" + (ox + cx2) + "' y1='" + (oy + cy2) + "' x2='" + (ox + tx2) + "' y2='" + (oy + ty2) + "' stroke='" + palette.red.hex + "' stroke-width='0.9'/>"
          s += "<circle cx='" + (ox + cx2) + "' cy='" + (oy + cy2) + "' r='" + CHIP / 2 + "' fill='" + palette.red.hex + "' stroke='" + palette.red.hex + "' stroke-width='1'/>"
          s += TX(ox + cx2, oy + cy2, ri + 1, 8, true, "middle", palette.white.hex, type.svgFonts.data)
        })
        return s
      },
    })
  }

  var fourViewGrid = col({ grow: 1 }, [
    row({ grow: 1 }, [buildViewCell(0), buildViewCell(1)]),
    row({ grow: 1 }, [buildViewCell(2), buildViewCell(3)]),
  ])

  var bodyRow = row({ grow: 1 }, [specTable, fourViewGrid])

  var discBar = leaf({ basis: discH, render: (b) => svgDisc(t, hdr, b.width, b.y, b.height) })

  var root = col({}, [headerLeaf, detailsBar, bodyRow, discBar])
  var resolved = solveLayout(root, { x: 0, y: 0, width: W, height: H })

  var s = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'>"
  s += "<rect width='" + W + "' height='" + H + "' fill='" + palette.white.hex + "' stroke='" + palette.ink.hex + "' stroke-width='1.5'/>"
  s += renderLayoutToSVG(resolved)

  // Frame around the spec-table column: spans from the top of the DETAILS bar
  // down to the disclaimer, not just around the table's own rows - a purely
  // decorative cross-cutting line that doesn't belong to any single region, so
  // it's drawn from the already-resolved boxes instead of forcing the tree
  // into an unnatural shape just to own this one rectangle.
  var rDetails = resolved.children[1]
  var rDisc = resolved.children[3]
  var rSpecTable = resolved.children[2].children[0]
  s += R(rSpecTable.x, rDetails.y, rSpecTable.width, rDisc.y - rDetails.y, "none", palette.ink.hex, "1")

  s += "</svg>"
  return s
}

/* ---- DESIGN PAGE: garment-independent, only needs the base translations ---- */
export function buildDesignPage(lang, d, hdr, logo, idx, txName, txPosDetail) {
  var t = T[lang] || T.ES
  var W = 1200, H = 900, hH = 80, discH = 20, bodyH = H - hH - discH
  var isEmb = isEmbTec(d.tec), isWhole = isWholePosF(d.pos)
  var LW = isEmb ? 430 : 370
  var RX = LW, RW = W - LW, RH = bodyH

  var s = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'>"
  s += "<rect width='" + W + "' height='" + H + "' fill='" + palette.white.hex + "' stroke='" + palette.ink.hex + "' stroke-width='1.5'/>"
  s += svgHeader(hdr, logo, W, hH)
  // role.priority: this page's title bar - solid blue, white text.
  s += R(0, hH, W, 22, palette.blue.hex, palette.ink.hex, "0.8")
  s += TX(W / 2, hH + 11, t.pageDesign + " " + (idx + 1) + " - " + (txName || d.name), 11, true, "middle", palette.white.hex)

  var by = hH + 22
  s += R(0, by, LW, bodyH, palette.white.hex, palette.ink.hex, "0.8")

  var ty = by + 16
  // Third element flags a row's value as DATA (mono face) vs descriptive text.
  var rows = [
    [t.fileName, d.fileName || NA, true],
    [t.driveLink, d.driveLink || NA, true],
    [t.pageDesign + " #", idx + 1, true],
    [d.name ? "Nombre" : "", (txName || d.name), false],
    [t.pos, d.pos, false],
    [t.tec, d.tec, false],
  ]
  if (!isWhole) { rows.push([t.posDetail, txPosDetail || d.posDetail || NA, false], [t.wDes, d.w ? (d.w + " mm") : NA, true], [t.hDes, d.h ? (d.h + " mm") : NA, true]) }
  rows.forEach(function (row) {
    if (!row[0]) return
    s += TX(INSET, ty, row[0] + ":", 9, true, "start") + TX(Math.round(LW * COL.value) + TEXT_PAD, ty, String(row[1] || NA), 9, false, "start", undefined, row[2] ? type.svgFonts.data : type.svgFonts.ui)
    ty += ROW.kv
  })

  if (isWhole) {
    // role.highlight: a small, high-priority exception note - white box, ink
    // keyline, thick yellow left accent. Same treatment as the wizard UI's
    // "covers the whole garment" callout (App.jsx) - one language, two surfaces.
    var boxH = 24
    s += R(12, ty, LW - 24, boxH, palette.white.hex, palette.ink.hex, "0.8")
    s += R(12, ty, 4, boxH, palette.yellow.hex, palette.yellow.hex, "0")
    s += TX(12 + 4 + 10, ty + boxH / 2, t.noApplica, 8, false, "start")
    ty += boxH + 6
  }

  ty += 6
  s += renderColorSpecs({ x: 0, y: ty, width: LW, height: by + bodyH - ty }, { colors: d.colors })
  ty += colorSpecsHeight(d.colors, ty, by + bodyH)

  if (isEmb && d.emb) {
    ty += 8
    s += renderEmbSpecs({ x: 0, y: ty, width: LW, height: by + bodyH - ty }, { emb: d.emb, title: t.embTitle })
  }

  var pad = 30
  s += R(RX, by, RW, RH, palette.white.hex, palette.ink.hex, "0.8")

  if (d.imageData) {
    var dimSpace = 50
    var maxIW = RW - pad * 2 - dimSpace * 2
    var maxIH = RH - pad * 2 - dimSpace * 2
    var iw = parseFloat(d.imgNatW) || maxIW, ih = parseFloat(d.imgNatH) || maxIH
    var scale = Math.min(maxIW / iw, maxIH / ih, 1)
    var dw = Math.round(iw * scale), dh = Math.round(ih * scale)
    var imgX = RX + Math.round((RW - dw) / 2)
    var imgY = by + Math.round((RH - dh) / 2)

    var mime = d.imageType === "svg" ? "image/svg+xml" : "image/png"
    s += "<image href='data:" + mime + ";base64," + d.imageData + "' x='" + imgX + "' y='" + imgY + "' width='" + dw + "' height='" + dh + "' preserveAspectRatio='xMidYMid meet'/>"
    s += R(imgX, imgY, dw, dh, "none", palette.red.hex, "0.8")

    var wLabel = (d.w ? d.w + " mm" : "w")
    var hLabel = (d.h ? d.h + " mm" : "h")
    s += dimLine(imgX, imgY, imgX + dw, imgY + dh, wLabel, dh + 30, true)
    s += dimLine(imgX, imgY, imgX + dw, imgY + dh, hLabel, dw + 30, false)
  } else if (d.illustrationBrief) {
    // role.highlight: same white-box/ink-keyline/thick-yellow-left-accent
    // treatment as the "covers the whole garment" note above - here it
    // carries the AI-authored illustration brief (F3.3) instead of inventing
    // vector art: a concrete instruction for a human illustrator to execute,
    // composed with the layout engine so it respects the page's grid/spacing.
    var briefRoot = row({}, [
      leaf({ basis: 4, render: (b) => R(b.x, b.y, b.width, b.height, palette.yellow.hex, palette.yellow.hex, "0") }),
      col({ grow: 1, padding: 16, gap: 8 }, [
        leaf({ basis: 14, render: (b) => TX(b.x, b.y + 7, "ILUSTRACION A REALIZAR", 9, true, "start") }),
        leaf({
          grow: 1,
          render: (b) => {
            var lines = wrapLines(d.illustrationBrief, b.width, 11)
            var lh = 16
            var s2 = ""
            lines.forEach(function (line, i) {
              s2 += TX(b.x, b.y + 10 + i * lh, line, 11, false, "start")
            })
            return s2
          },
        }),
      ]),
    ])
    s += renderLayoutToSVG(solveLayout(briefRoot, { x: RX, y: by, width: RW, height: RH }))
  } else {
    s += TX(RX + RW / 2, by + RH / 2, t.illZone, 11, false, "middle", "#B7BCC6")
    var cors = [[RX + 20, by + 20], [RX + 20, by + RH - 20], [RX + RW - 20, by + 20], [RX + RW - 20, by + RH - 20]]
    cors.forEach(function (pt) {
      s += "<line x1='" + (pt[0] - 12) + "' y1='" + pt[1] + "' x2='" + (pt[0] + 12) + "' y2='" + pt[1] + "' stroke='#ddd' stroke-width='1'/>"
      s += "<line x1='" + pt[0] + "' y1='" + (pt[1] - 12) + "' x2='" + pt[0] + "' y2='" + (pt[1] + 12) + "' stroke='#ddd' stroke-width='1'/>"
    })
  }

  s += svgDisc(t, hdr, W, H - discH, discH)
  s += "</svg>"
  return s
}

export function buildAllPages(lang, hdr, parts, designs, logo, txData, garment) {
  var pages = []
  var txP = txData || null
  pages.push({ name: "pagina_principal", svg: buildPage1(lang, hdr, parts, logo, txP, garment) })
  designs.forEach(function (d, i) {
    var txName = txP && txP.designs && txP.designs[i] ? txP.designs[i].name : null
    var txPos = txP && txP.designs && txP.designs[i] ? txP.designs[i].posDetail : null
    pages.push({ name: "diseno_" + (i + 1) + "_" + (d.name || "").replace(/\s+/g, "_"), svg: buildDesignPage(lang, d, hdr, logo, i, txName, txPos) })
  })
  return pages
}
