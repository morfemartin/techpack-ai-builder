import { T } from "../core/i18n.js"
import { NA } from "../core/svgPrimitives.js"
import { h2c } from "../core/colorUtils.js"
import { isEmbTec, isWholePosF } from "../core/helpers.js"
import { palette, role, type } from "../design/tokens.js"
import { GENERIC_SILHOUETTE } from "../garments/genericSilhouette.js"

// This is the live on-screen mockup shown in the "Vista Previa" wizard step -
// the thing a user actually looks at before clicking "Generar SVG". It has to
// read as the SAME document as the exported SVG (src/pages/buildPages.js), so
// it pulls from the exact same design tokens rather than its own palette.

const C = palette
const hairThin = "0.5px solid " + C.ink.hex
const hair = "1px solid " + C.ink.hex

export function Preview({ lang, hdr, parts, designs, logo, page, txCache, garment }) {
  var t = T[lang] || T.ES
  var pn = garment.partLabels[lang] || garment.partLabels.ES
  var ap = parts.filter((p) => p.on)
  var SCALE = 0.54
  var W = 1200, H = 900, hH = 80, discH = 28, bodyH = H - hH - discH
  var lW = 320, rW = W - lW, vW = rW / 2, vH = bodyH / 2
  var rH = Math.max(16, Math.floor((bodyH - 42) / Math.max(ap.length, 1)))
  var txData = txCache && txCache[lang]
  var wrap = { width: W, height: H, transformOrigin: "top left", transform: "scale(" + SCALE + ")", background: C.white.hex, border: "1.5px solid " + C.ink.hex, position: "absolute", top: 0, left: 0, fontFamily: type.fonts.ui, boxSizing: "border-box", overflow: "hidden" }

  function HdrUI() {
    return (
      <div style={{ height: hH, display: "flex", borderBottom: hair }}>
        <div style={{ width: 88, background: C.white.hex, border: hair, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {logo ? <img src={logo} style={{ maxWidth: 80, maxHeight: hH - 8, objectFit: "contain" }} alt="logo" /> : <span style={{ fontSize: 9, color: "#9AA0AB" }}>LOGO</span>}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, display: "flex", borderBottom: hairThin }}>
            {[["SEASON", hdr.season, 58, 100], ["STYLE NO", hdr.sno, 62, 95], ["CATEGORY", hdr.cat, 68, 90], ["FABRIC", hdr.fab, 54, 130], ["FACTORY", hdr.fac, 56, 100]].map((r, i) => (
              <div key={i} style={{ display: "flex", flexShrink: 0 }}>
                <div style={{ width: r[2], background: C.white.hex, borderRight: hairThin, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: "bold", textAlign: "center", padding: "0 2px", color: C.ink.hex }}>{r[0]}</div>
                <div style={{ width: r[3], borderRight: hairThin, display: "flex", alignItems: "center", padding: "0 4px", fontSize: 9, overflow: "hidden", fontFamily: type.fonts.data, color: C.ink.hex }}>{r[1] || NA}</div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, display: "flex" }}>
            {[["BRAND", hdr.brand, 50, 88], ["NAME", (txData && txData.pname) || hdr.pname, 48, 510], ["INPUT", hdr.ind, 48, 85], ["OUTPUT", hdr.outd, 54, 100]].map((r, i) => (
              <div key={i} style={{ display: "flex", flexShrink: 0 }}>
                <div style={{ width: r[2], background: C.white.hex, borderRight: hairThin, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: "bold", textAlign: "center", padding: "0 2px", color: C.ink.hex }}>{r[0]}</div>
                <div style={{ width: r[3], borderRight: hairThin, display: "flex", alignItems: "center", padding: "0 4px", fontSize: 9, overflow: "hidden", fontFamily: type.fonts.data, color: C.ink.hex }}>{r[1] || NA}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function DiscUI() {
    return (
      <div style={{ height: discH, background: C.white.hex, borderTop: hair, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.ink.hex }}>
        {t.disc} <b style={{ margin: "0 4px" }}>{hdr.brand || "[Marca]"}</b>
        {t.discSfx}
      </div>
    )
  }

  if (page === 0) {
    var txP2 = txData && txData.parts
    return (
      <div style={{ overflow: "auto", background: C.canvas.hex, padding: 10 }}>
        <div style={{ width: W * SCALE, height: H * SCALE, position: "relative" }}>
          <div style={wrap}>
            <HdrUI />
            {/* role.priority: section header bar spanning the page */}
            <div style={{ height: 22, background: role.priority.fill, color: role.priority.on, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold" }}>DETAILS</div>
            <div style={{ display: "flex", height: bodyH - 22 }}>
              <div style={{ width: lW, borderRight: hair, flexShrink: 0, overflow: "hidden" }}>
                <div style={{ height: 20, background: "#EDEEF0", display: "flex", fontSize: 8, fontWeight: "bold", borderBottom: hairThin, color: C.ink.hex }}>
                  <div style={{ width: "20%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: hairThin }}>#</div>
                  <div style={{ width: "32%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: hairThin }}>{t.sp}</div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{t.dt}</div>
                </div>
                {ap.map((p, i) => (
                  <div key={p.id} style={{ height: rH, display: "flex", alignItems: "center", background: i % 2 === 0 ? C.white.hex : "#F7F7F8", borderBottom: hairThin }}>
                    <div style={{ width: "20%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {/* role.index chip - same mark used in the wizard stepper and the exported SVG */}
                      <span style={{ width: 13, height: 13, background: role.index.fill, color: role.index.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 7, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                    </div>
                    <div style={{ width: "32%", display: "flex", alignItems: "center", padding: "0 3px", fontSize: 8, color: C.ink.hex, borderRight: hairThin, overflow: "hidden", flexShrink: 0 }}>{pn[p.id] || p.customName || NA}</div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 3px", fontSize: 8, color: C.ink.hex, fontFamily: type.fonts.data, overflow: "hidden" }}>{txP2 ? txP2[i] : p.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", overflow: "hidden" }}>
                {[0, 1, 2, 3].map((vi) => (
                  <div key={vi} style={{ border: hairThin, position: "relative", overflow: "hidden", background: C.white.hex }}>
                    <div style={{ position: "absolute", top: 5, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: "bold", color: C.ink.hex, zIndex: 2 }}>{t.vw[vi]}</div>
                    <svg viewBox="0 0 200 150" style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", width: vW * 0.76, height: vH * 0.7 }} overflow="visible">
                      <path d={garment.guides ? garment.guides[vi] : GENERIC_SILHOUETTE} fill="none" stroke="#ccc" strokeWidth="1" strokeDasharray="5,3" />
                      {(garment.callouts ? garment.callouts[vi] : []).map((co) => {
                        var pid = co[0], tx3 = co[1], ty3 = co[2], cx3 = co[3], cy3 = co[4]
                        var ri = ap.findIndex((a) => a.id === pid)
                        if (ri < 0) return null
                        return (
                          <g key={pid}>
                            <line x1={cx3} y1={cy3} x2={tx3} y2={ty3} stroke={C.red.hex} strokeWidth="0.9" />
                            <circle cx={cx3} cy={cy3} r="8" fill={C.red.hex} stroke={C.red.hex} strokeWidth="1" />
                            <text x={cx3} y={cy3} textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="bold" fill={C.white.hex} fontFamily={type.svgFonts.data}>
                              {ri + 1}
                            </text>
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                ))}
              </div>
            </div>
            <DiscUI />
          </div>
        </div>
      </div>
    )
  }

  var d = designs[page - 1]
  var isEmb2 = isEmbTec(d.tec), isWhole2 = isWholePosF(d.pos)
  var LW2 = isEmb2 ? 420 : 360
  var txName2 = txData && txData.designs && txData.designs[page - 1] ? txData.designs[page - 1].name : null
  var txPos2 = txData && txData.designs && txData.designs[page - 1] ? txData.designs[page - 1].posDetail : null
  // Third element flags a row's value as DATA (mono face) vs descriptive text -
  // same split used in buildPages.js's buildDesignPage.
  var infoRows = [
    [t.fileName, d.fileName || NA, true],
    [t.driveLink, d.driveLink || NA, true],
    [d.name, txName2 || d.name, false],
    [t.pos, d.pos, false],
    [t.tec, d.tec, false],
  ]
  if (!isWhole2) {
    infoRows.push([t.posDetail, txPos2 || d.posDetail || NA, false], [t.wDes, d.w ? d.w + " mm" : NA, true], [t.hDes, d.h ? d.h + " mm" : NA, true])
  }

  return (
    <div style={{ overflow: "auto", background: C.canvas.hex, padding: 10 }}>
      <div style={{ width: W * SCALE, height: H * SCALE, position: "relative" }}>
        <div style={wrap}>
          <HdrUI />
          {/* role.priority: this page's title bar */}
          <div style={{ height: 22, background: role.priority.fill, color: role.priority.on, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold" }}>
            {t.pageDesign} {page} - {txName2 || d.name}
          </div>
          <div style={{ display: "flex", height: bodyH - 22 }}>
            <div style={{ width: LW2, borderRight: hair, padding: "10px 12px", boxSizing: "border-box", overflowY: "auto" }}>
              {infoRows.map((row, i) => {
                if (!row[0]) return null
                return (
                  <div key={i} style={{ marginBottom: 6, display: "flex", gap: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.ink.hex, minWidth: 100, flexShrink: 0 }}>{row[0]}:</span>
                    <span style={{ fontSize: 9, color: C.ink.hex, wordBreak: "break-all", fontFamily: row[2] ? type.fonts.data : type.fonts.ui }}>{row[1] || NA}</span>
                  </div>
                )
              })}
              {isWhole2 && (
                // role.highlight: small high-priority exception note - same
                // treatment as the "Diseños" step form and the exported SVG.
                <div style={{ display: "flex", alignItems: "stretch", gap: 6, marginBottom: 8, border: hair, borderLeft: "4px solid " + role.highlight.fill }}>
                  <span style={{ padding: "5px 6px", fontSize: 9, color: C.ink.hex }}>{t.noApplica}</span>
                </div>
              )}
              <hr style={{ border: "none", borderTop: "1px solid #ddd", margin: "8px 0" }} />
              {/* role.priority bar - same treatment as the embroidery title below it */}
              <div style={{ background: role.priority.fill, color: role.priority.on, fontSize: 10, fontWeight: 700, textAlign: "center", padding: "4px 0", marginBottom: 8 }}>PANTONE / CMYK</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {(d.colors || []).map((col, i) => {
                  if (!col.hex) return null
                  var cm = h2c(col.hex)
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: C.white.hex, border: "1px solid " + C.ink.hex }}>
                      <div style={{ width: 18, height: 18, background: col.hex, border: "1px solid " + C.ink.hex, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.ink.hex }}>{col.name || col.hex}</div>
                        <div style={{ fontSize: 9, color: C.ink.hex, fontFamily: type.fonts.data }}>
                          C:{cm.c} M:{cm.m} Y:{cm.y} K:{cm.k}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {isEmb2 && d.emb && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ background: role.priority.fill, color: role.priority.on, fontSize: 10, fontWeight: 700, padding: "4px 8px", marginBottom: 6, textAlign: "center" }}>{t.embTitle}</div>
                  {[["Maquina", d.emb.machine], ["Puntadas", d.emb.stitches], ["Cam.color", d.emb.colorChanges], ["Paradas", d.emb.stops], ["Cortes", d.emb.trims], ["Tela", d.emb.fabric], ["Estab.Top", d.emb.stabTopping], ["Estab.Back", d.emb.stabBacking], ["Dim.", d.emb.w && d.emb.h ? d.emb.w + "x" + d.emb.h + " mm" : NA], ["Area", d.emb.area ? d.emb.area + " mm2" : NA], ["Max punt.", d.emb.maxStitch ? d.emb.maxStitch + " mm" : NA], ["Min punt.", d.emb.minStitch ? d.emb.minStitch + " mm" : NA], ["Hilo", d.emb.totalThread], ["Bobina", d.emb.totalBobbin]].map((row, i) => (
                    <div key={i} style={{ display: "flex", gap: 4, marginBottom: 3, fontSize: 9 }}>
                      <span style={{ fontWeight: 700, color: C.ink.hex, minWidth: 72, flexShrink: 0 }}>{row[0]}:</span>
                      <span style={{ color: C.ink.hex, fontFamily: type.fonts.data }}>{row[1] || NA}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1, background: C.white.hex, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {d.imageData ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <img src={"data:" + (d.imageType === "svg" ? "image/svg+xml" : "image/png") + ";base64," + d.imageData} style={{ maxWidth: (W - LW2) * 0.7, maxHeight: bodyH * 0.7, objectFit: "contain", display: "block", border: "1px solid " + C.red.hex }} alt="design" />
                  {(d.w || d.h) && (
                    <div style={{ position: "absolute", bottom: -28, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: C.red.hex, fontFamily: type.fonts.data }}>
                      {d.w && <span>W: {d.w}mm</span>}
                      {d.w && d.h && <span> x </span>}
                      {d.h && <span>H: {d.h}mm</span>}
                    </div>
                  )}
                </div>
              ) : d.illustrationBrief ? (
                // role.highlight: same white-box/ink-keyline/thick-yellow-left-accent
                // note language used for the "covers the whole garment" callout
                // above - here it carries the AI-authored illustration brief (F3.3)
                // instead of inventing vector art the model can't actually draw.
                <div style={{ display: "flex", width: "90%", maxHeight: "80%", border: `1px solid ${C.ink.hex}`, background: C.white.hex }}>
                  <div style={{ width: 4, flexShrink: 0, background: role.highlight.fill }} />
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em", color: C.ink.hex }}>Ilustración a realizar</div>
                    <div style={{ fontSize: 11, fontFamily: type.fonts.ui, color: C.ink.hex, lineHeight: 1.4 }}>{d.illustrationBrief}</div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", color: "#B7BCC6", fontSize: 11 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>+</div>
                  {t.illZone}
                </div>
              )}
            </div>
          </div>
          <DiscUI />
        </div>
      </div>
    </div>
  )
}
