import { T } from "../core/i18n.js"
import { NA, sv, R, TX, LBL, VAL, dimLine, svgHeader, svgDisc } from "../core/svgPrimitives.js"
import { h2c } from "../core/colorUtils.js"
import { isEmbTec, isWholePosF } from "../core/helpers.js"
import { row, col, leaf, solveLayout, renderLayoutToSVG } from "../layout/index.js"

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
  var W = 1200, H = 900, hH = 80, discH = 28
  var lW = 320
  var ap = parts.filter(function (p) { return p.on })
  var txP = txData && txData.parts ? txData.parts : null

  var headerLeaf = leaf({
    basis: hH,
    render: (b) => "<g transform='translate(" + b.x + " " + b.y + ")'>" + svgHeader(hdr, logo, b.width, b.height) + "</g>",
  })

  var detailsBar = leaf({
    basis: 22,
    render: (b) => R(b.x, b.y, b.width, b.height, "#f0f0f0", "#555", "0.8") + TX(b.x + b.width / 2, b.y + b.height / 2, "DETAILS", 11, true, "middle"),
  })

  var tableHeaderRow = leaf({
    basis: 20,
    render: (b) =>
      R(b.x, b.y, b.width, b.height, "#e8e8e8", "#aaa") +
      TX(b.x + b.width * 0.11, b.y + b.height / 2, "#", 8, true, "middle") +
      TX(b.x + b.width * 0.32, b.y + b.height / 2, t.sp, 8, true, "middle") +
      TX(b.x + b.width * 0.62, b.y + b.height / 2, t.dt, 8, true, "middle") +
      TX(b.x + b.width * 0.82, b.y + b.height / 2, "Archivo / Drive", 7, true, "middle"),
  })

  var partRows = ap.map((p, i) =>
    leaf({
      grow: 1,
      min: 16,
      render: (b) => {
        var bg = i % 2 === 0 ? "white" : "#f9f9f9"
        var nm = pn[p.id] || p.customName || "P" + p.id
        var v = txP ? txP[i] : p.val
        var divX1 = Math.round(b.x + b.width * 0.21)
        var divX2 = Math.round(b.x + b.width * 0.5)
        return (
          R(b.x, b.y, b.width, b.height, bg, "#ccc", "0.4") +
          TX(b.x + b.width * 0.11, b.y + b.height / 2, i + 1, 8, false, "middle") +
          "<line x1='" + divX1 + "' y1='" + b.y + "' x2='" + divX1 + "' y2='" + (b.y + b.height) + "' stroke='#ddd' stroke-width='0.5'/>" +
          TX(b.x + b.width * 0.21 + 3, b.y + b.height / 2, nm, 7, false, "start") +
          "<line x1='" + divX2 + "' y1='" + b.y + "' x2='" + divX2 + "' y2='" + (b.y + b.height) + "' stroke='#ddd' stroke-width='0.5'/>" +
          TX(b.x + b.width * 0.5 + 3, b.y + b.height / 2, v || NA, 7, false, "start")
        )
      },
    })
  )

  var specTable = col({ basis: lW }, [tableHeaderRow, ...partRows])

  function buildViewCell(vi) {
    return leaf({
      grow: 1,
      render: (b) => {
        var s = R(b.x, b.y, b.width, b.height, "white", "#aaa", "0.8")
        s += TX(b.x + b.width / 2, b.y + 14, t.vw[vi], 11, true, "middle")
        var ox = b.x + (b.width - 200) / 2, oy = b.y + 22
        s += "<g transform='translate(" + ox + " " + oy + ")'><path d='" + garment.guides[vi] + "' fill='none' stroke='#ccc' stroke-width='1' stroke-dasharray='5,3'/></g>"
        garment.callouts[vi].forEach((co) => {
          var pid = co[0], tx2 = co[1], ty2 = co[2], cx2 = co[3], cy2 = co[4]
          var ri = ap.findIndex((a) => a.id === pid)
          if (ri < 0) return
          s += "<line x1='" + (ox + cx2) + "' y1='" + (oy + cy2) + "' x2='" + (ox + tx2) + "' y2='" + (oy + ty2) + "' stroke='#c0392b' stroke-width='0.9'/>"
          s += "<circle cx='" + (ox + cx2) + "' cy='" + (oy + cy2) + "' r='9' fill='white' stroke='#c0392b' stroke-width='1'/>"
          s += TX(ox + cx2, oy + cy2, ri + 1, 8, true, "middle")
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
  s += "<rect width='" + W + "' height='" + H + "' fill='white' stroke='#333' stroke-width='1.5'/>"
  s += renderLayoutToSVG(resolved)

  // Frame around the spec-table column: spans from the top of the DETAILS bar
  // down to the disclaimer, not just around the table's own rows - a purely
  // decorative cross-cutting line that doesn't belong to any single region, so
  // it's drawn from the already-resolved boxes instead of forcing the tree
  // into an unnatural shape just to own this one rectangle.
  var rDetails = resolved.children[1]
  var rDisc = resolved.children[3]
  var rSpecTable = resolved.children[2].children[0]
  s += R(rSpecTable.x, rDetails.y, rSpecTable.width, rDisc.y - rDetails.y, "none", "#555", "1")

  s += "</svg>"
  return s
}

/* ---- DESIGN PAGE: garment-independent, only needs the base translations ---- */
export function buildDesignPage(lang, d, hdr, logo, idx, txName, txPosDetail) {
  var t = T[lang] || T.ES
  var W = 1200, H = 900, hH = 80, discH = 28, bodyH = H - hH - discH
  var isEmb = isEmbTec(d.tec), isWhole = isWholePosF(d.pos)
  var LW = isEmb ? 430 : 370
  var RX = LW, RW = W - LW, RH = bodyH

  var s = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'>"
  s += "<rect width='" + W + "' height='" + H + "' fill='white' stroke='#333' stroke-width='1.5'/>"
  s += svgHeader(hdr, logo, W, hH)
  s += R(0, hH, W, 22, "#f0f0f0", "#555", "0.8")
  s += TX(W / 2, hH + 11, t.pageDesign + " " + (idx + 1) + " - " + (txName || d.name), 11, true, "middle")

  var by = hH + 22
  s += R(0, by, LW, bodyH, "white", "#aaa", "0.8")

  var ty = by + 16
  var rows = [[t.fileName, d.fileName || NA], [t.driveLink, d.driveLink || NA], [t.pageDesign + " #", idx + 1], [d.name ? "Nombre" : "", (txName || d.name)], [t.pos, d.pos], [t.tec, d.tec]]
  if (!isWhole) { rows.push([t.posDetail, txPosDetail || d.posDetail || NA], [t.wDes, d.w ? (d.w + " mm") : NA], [t.hDes, d.h ? (d.h + " mm") : NA]) }
  else { rows.push([t.noApplica, ""]) }
  rows.forEach(function (row) {
    if (!row[0]) return
    s += TX(12, ty, row[0] + ":", 9, true, "start") + TX(LW * 0.52, ty, String(row[1] || NA), 9, false, "start")
    ty += 21
  })

  ty += 6
  s += "<line x1='10' y1='" + ty + "' x2='" + (LW - 10) + "' y2='" + ty + "' stroke='#ddd' stroke-width='1'/>"
  ty += 16
  s += TX(LW / 2, ty, "PANTONE / CMYK", 10, true, "middle")
  ty += 20
  ;(d.colors || []).forEach(function (col) {
    if (!col.hex || ty > by + bodyH - 32) return
    var cm = h2c(col.hex)
    s += R(12, ty - 10, 20, 20, col.hex, "#ccc", "0.5")
    s += TX(38, ty - 2, col.name || col.hex, 8, true, "start")
    s += TX(38, ty + 9, "C:" + cm.c + " M:" + cm.m + " Y:" + cm.y + " K:" + cm.k + " | " + col.hex, 7, false, "start")
    ty += 30
  })

  if (isEmb && d.emb) {
    var ef = d.emb
    ty += 8
    s += "<line x1='10' y1='" + ty + "' x2='" + (LW - 10) + "' y2='" + ty + "' stroke='#ddd' stroke-width='1'/>"
    ty += 16
    s += R(10, ty - 10, LW - 20, 18, "#1a4fd6", "none")
    s += TX(LW / 2, ty - 1, t.embTitle, 9, true, "middle", "white")
    ty += 18
    var er = [["Formato", ef.machine], ["Puntadas", ef.stitches], ["Cambios color", ef.colorChanges], ["Paradas/Cortes", ef.stops + "/" + ef.trims], ["Tela", ef.fabric], ["Estab.Top", ef.stabTopping], ["Estab.Backing", ef.stabBacking], ["Dimension", ef.w && ef.h ? (ef.w + "x" + ef.h + " mm") : NA], ["Area", ef.area ? (ef.area + " mm2") : NA], ["Max puntada", ef.maxStitch ? (ef.maxStitch + " mm") : NA], ["Min puntada", ef.minStitch ? (ef.minStitch + " mm") : NA], ["Max salto", ef.maxJump ? (ef.maxJump + " mm") : NA], ["Hilo", ef.totalThread], ["Bobina", ef.totalBobbin]]
    er.forEach(function (row) {
      if (ty > by + bodyH - 16) return
      s += TX(12, ty, row[0] + ":", 8, true, "start") + TX(LW * 0.55, ty, row[1] || NA, 8, false, "start")
      ty += 16
    })
    if (ef.stopSeq && ef.stopSeq.length > 0 && ty < by + bodyH - 40) {
      ty += 4
      s += "<line x1='10' y1='" + ty + "' x2='" + (LW - 10) + "' y2='" + ty + "' stroke='#eee' stroke-width='0.8'/>"
      ty += 14
      s += TX(12, ty, "Secuencia:", 8, true, "start")
      ty += 14
      ef.stopSeq.forEach(function (st) {
        if (ty > by + bodyH - 14) return
        s += TX(14, ty, "Stop " + st.stop + ": " + st.name + " (" + st.stitches + " pt.)", 8, false, "start")
        ty += 13
      })
    }
  }

  var pad = 30
  s += R(RX, by, RW, RH, "#fafafa", "#aaa", "0.8")

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
    s += R(imgX, imgY, dw, dh, "none", "#c0392b", "0.8")

    var wLabel = (d.w ? d.w + " mm" : "w")
    var hLabel = (d.h ? d.h + " mm" : "h")
    s += dimLine(imgX, imgY, imgX + dw, imgY + dh, wLabel, dh + 30, true)
    s += dimLine(imgX, imgY, imgX + dw, imgY + dh, hLabel, dw + 30, false)
  } else {
    s += TX(RX + RW / 2, by + RH / 2, t.illZone, 11, false, "middle", "#ccc")
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
