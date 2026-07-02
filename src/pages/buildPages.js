import { T } from "../core/i18n.js"
import { NA, sv, R, TX, LBL, VAL, dimLine, svgHeader, svgDisc } from "../core/svgPrimitives.js"
import { h2c } from "../core/colorUtils.js"
import { isEmbTec, isWholePosF } from "../core/helpers.js"

/* ---- PAGE 1: parts spec sheet + 4-view diagram (garment-specific) ---- */
export function buildPage1(lang, hdr, parts, logo, txData, garment) {
  var t = T[lang] || T.ES
  var pn = garment.partLabels[lang] || garment.partLabels.ES
  var W = 1200, H = 900, hH = 80, discH = 28, bodyH = H - hH - discH
  var lW = 320, rW = W - lW, vW = rW / 2, vH = bodyH / 2
  var ap = parts.filter(function (p) { return p.on })
  var rH = Math.max(16, Math.floor((bodyH - 42) / Math.max(ap.length, 1)))
  var txP = txData && txData.parts ? txData.parts : null

  var s = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'>"
  s += "<rect width='" + W + "' height='" + H + "' fill='white' stroke='#333' stroke-width='1.5'/>"
  s += svgHeader(hdr, logo, W, hH)
  s += R(0, hH, W, 22, "#f0f0f0", "#555", "0.8") + TX(W / 2, hH + 11, "DETAILS", 11, true, "middle")

  var sy = hH + 22
  s += R(0, sy, lW, 20, "#e8e8e8", "#aaa")
  s += TX(lW * 0.11, sy + 10, "#", 8, true, "middle") + TX(lW * 0.32, sy + 10, t.sp, 8, true, "middle") + TX(lW * 0.62, sy + 10, t.dt, 8, true, "middle") + TX(lW * 0.82, sy + 10, "Archivo / Drive", 7, true, "middle")

  ap.forEach(function (p, i) {
    var ry = sy + 20 + i * rH, bg = i % 2 === 0 ? "white" : "#f9f9f9"
    var nm = pn[p.id] || p.customName || ("P" + p.id)
    var v = txP ? txP[i] : p.val
    s += R(0, ry, lW, rH, bg, "#ccc", "0.4")
    s += TX(lW * 0.11, ry + rH / 2, i + 1, 8, false, "middle")
    s += "<line x1='" + Math.round(lW * 0.21) + "' y1='" + ry + "' x2='" + Math.round(lW * 0.21) + "' y2='" + (ry + rH) + "' stroke='#ddd' stroke-width='0.5'/>"
    s += TX(lW * 0.21 + 3, ry + rH / 2, nm, 7, false, "start")
    s += "<line x1='" + Math.round(lW * 0.5) + "' y1='" + ry + "' x2='" + Math.round(lW * 0.5) + "' y2='" + (ry + rH) + "' stroke='#ddd' stroke-width='0.5'/>"
    s += TX(lW * 0.5 + 3, ry + rH / 2, v || NA, 7, false, "start")
  })
  s += R(0, hH, lW, bodyH, "none", "#555", "1")

  for (var vi = 0; vi < 4; vi++) {
    var vx = lW + (vi % 2) * vW, vy = hH + Math.floor(vi / 2) * vH
    s += R(vx, vy, vW, vH, "white", "#aaa", "0.8")
    s += TX(vx + vW / 2, vy + 14, t.vw[vi], 11, true, "middle")
    var ox = vx + (vW - 200) / 2, oy = vy + 22
    s += "<g transform='translate(" + ox + " " + oy + ")'><path d='" + garment.guides[vi] + "' fill='none' stroke='#ccc' stroke-width='1' stroke-dasharray='5,3'/></g>"
    garment.callouts[vi].forEach(function (co) {
      var pid = co[0], tx2 = co[1], ty2 = co[2], cx2 = co[3], cy2 = co[4]
      var ri = ap.findIndex(function (a) { return a.id === pid })
      if (ri < 0) return
      s += "<line x1='" + (ox + cx2) + "' y1='" + (oy + cy2) + "' x2='" + (ox + tx2) + "' y2='" + (oy + ty2) + "' stroke='#c0392b' stroke-width='0.9'/>"
      s += "<circle cx='" + (ox + cx2) + "' cy='" + (oy + cy2) + "' r='9' fill='white' stroke='#c0392b' stroke-width='1'/>"
      s += TX(ox + cx2, oy + cy2, ri + 1, 8, true, "middle")
    })
  }

  s += svgDisc(t, hdr, W, H - discH, discH)
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
