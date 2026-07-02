import { T } from "../core/i18n.js"
import { NA } from "../core/svgPrimitives.js"
import { h2c } from "../core/colorUtils.js"
import { isEmbTec, isWholePosF } from "../core/helpers.js"

export function Preview({ lang, hdr, parts, designs, logo, page, txCache, garment }) {
  var t = T[lang] || T.ES
  var pn = garment.partLabels[lang] || garment.partLabels.ES
  var ap = parts.filter((p) => p.on)
  var SCALE = 0.54
  var W = 1200, H = 900, hH = 80, discH = 28, bodyH = H - hH - discH
  var lW = 320, rW = W - lW, vW = rW / 2, vH = bodyH / 2
  var rH = Math.max(16, Math.floor((bodyH - 42) / Math.max(ap.length, 1)))
  var txData = txCache && txCache[lang]
  var wrap = { width: W, height: H, transformOrigin: "top left", transform: "scale(" + SCALE + ")", background: "white", border: "1.5px solid #333", position: "absolute", top: 0, left: 0, fontFamily: "Arial,sans-serif", boxSizing: "border-box", overflow: "hidden" }

  function HdrUI() {
    return (
      <div style={{ height: hH, display: "flex", borderBottom: "1px solid #555" }}>
        <div style={{ width: 88, background: "#f5f5f5", border: "1px solid #555", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {logo ? <img src={logo} style={{ maxWidth: 80, maxHeight: hH - 8, objectFit: "contain" }} alt="logo" /> : <span style={{ fontSize: 9, color: "#aaa" }}>LOGO</span>}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, display: "flex", borderBottom: "0.5px solid #999" }}>
            {[["SEASON", hdr.season, 58, 100], ["STYLE NO", hdr.sno, 62, 95], ["CATEGORY", hdr.cat, 68, 90], ["FABRIC", hdr.fab, 54, 130], ["FACTORY", hdr.fac, 56, 100]].map((r, i) => (
              <div key={i} style={{ display: "flex", flexShrink: 0 }}>
                <div style={{ width: r[2], background: "#e8e8e8", borderRight: "0.5px solid #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: "bold", textAlign: "center", padding: "0 2px" }}>{r[0]}</div>
                <div style={{ width: r[3], borderRight: "0.5px solid #999", display: "flex", alignItems: "center", padding: "0 4px", fontSize: 9, overflow: "hidden" }}>{r[1] || NA}</div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, display: "flex" }}>
            {[["BRAND", hdr.brand, 50, 88], ["NAME", (txData && txData.pname) || hdr.pname, 48, 510], ["INPUT", hdr.ind, 48, 85], ["OUTPUT", hdr.outd, 54, 100]].map((r, i) => (
              <div key={i} style={{ display: "flex", flexShrink: 0 }}>
                <div style={{ width: r[2], background: "#e8e8e8", borderRight: "0.5px solid #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: "bold", textAlign: "center", padding: "0 2px" }}>{r[0]}</div>
                <div style={{ width: r[3], borderRight: "0.5px solid #999", display: "flex", alignItems: "center", padding: "0 4px", fontSize: 9, overflow: "hidden" }}>{r[1] || NA}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function DiscUI() {
    return (
      <div style={{ height: discH, background: "#f8f8f8", borderTop: "0.5px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#555" }}>
        {t.disc} <b style={{ margin: "0 4px" }}>{hdr.brand || "[Marca]"}</b>
        {t.discSfx}
      </div>
    )
  }

  if (page === 0) {
    var txP2 = txData && txData.parts
    return (
      <div style={{ overflow: "auto", background: "#c8cdd8", padding: 10, borderRadius: 8 }}>
        <div style={{ width: W * SCALE, height: H * SCALE, position: "relative" }}>
          <div style={wrap}>
            <HdrUI />
            <div style={{ height: 22, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold" }}>DETAILS</div>
            <div style={{ display: "flex", height: bodyH - 22 }}>
              <div style={{ width: lW, borderRight: "1px solid #555", flexShrink: 0, overflow: "hidden" }}>
                <div style={{ height: 20, background: "#e8e8e8", display: "flex", fontSize: 8, fontWeight: "bold", borderBottom: "0.5px solid #aaa" }}>
                  <div style={{ width: "20%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "0.5px solid #ccc" }}>#</div>
                  <div style={{ width: "32%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "0.5px solid #ccc" }}>{t.sp}</div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{t.dt}</div>
                </div>
                {ap.map((p, i) => (
                  <div key={p.id} style={{ height: rH, display: "flex", background: i % 2 === 0 ? "white" : "#f9f9f9", borderBottom: "0.5px solid #eee" }}>
                    <div style={{ width: "20%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#888", borderRight: "0.5px solid #eee", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ width: "32%", display: "flex", alignItems: "center", padding: "0 3px", fontSize: 8, color: "#333", borderRight: "0.5px solid #eee", overflow: "hidden", flexShrink: 0 }}>{pn[p.id] || p.customName || NA}</div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 3px", fontSize: 8, color: "#555", overflow: "hidden" }}>{txP2 ? txP2[i] : p.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", overflow: "hidden" }}>
                {[0, 1, 2, 3].map((vi) => (
                  <div key={vi} style={{ border: "0.5px solid #ccc", position: "relative", overflow: "hidden", background: "white" }}>
                    <div style={{ position: "absolute", top: 5, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: "bold", color: "#333", zIndex: 2 }}>{t.vw[vi]}</div>
                    <svg viewBox="0 0 200 150" style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", width: vW * 0.76, height: vH * 0.7 }} overflow="visible">
                      <path d={garment.guides[vi]} fill="none" stroke="#ccc" strokeWidth="1" strokeDasharray="5,3" />
                      {garment.callouts[vi].map((co) => {
                        var pid = co[0], tx3 = co[1], ty3 = co[2], cx3 = co[3], cy3 = co[4]
                        var ri = ap.findIndex((a) => a.id === pid)
                        if (ri < 0) return null
                        return (
                          <g key={pid}>
                            <line x1={cx3} y1={cy3} x2={tx3} y2={ty3} stroke="#c0392b" strokeWidth="0.9" />
                            <circle cx={cx3} cy={cy3} r="8" fill="white" stroke="#c0392b" strokeWidth="1" />
                            <text x={cx3} y={cy3} textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="bold" fill="#c0392b">
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
  var infoRows = [[t.fileName, d.fileName || NA], [t.driveLink, d.driveLink || NA], [d.name, txName2 || d.name], [t.pos, d.pos], [t.tec, d.tec]]
  if (!isWhole2) {
    infoRows.push([t.posDetail, txPos2 || d.posDetail || NA], [t.wDes, d.w ? d.w + " mm" : NA], [t.hDes, d.h ? d.h + " mm" : NA])
  } else {
    infoRows.push([t.noApplica, ""])
  }

  return (
    <div style={{ overflow: "auto", background: "#c8cdd8", padding: 10, borderRadius: 8 }}>
      <div style={{ width: W * SCALE, height: H * SCALE, position: "relative" }}>
        <div style={wrap}>
          <HdrUI />
          <div style={{ height: 22, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold" }}>
            {t.pageDesign} {page} - {txName2 || d.name}
          </div>
          <div style={{ display: "flex", height: bodyH - 22 }}>
            <div style={{ width: LW2, borderRight: "1px solid #aaa", padding: "10px 12px", boxSizing: "border-box", overflowY: "auto" }}>
              {infoRows.map((row, i) => {
                if (!row[0]) return null
                return (
                  <div key={i} style={{ marginBottom: 6, display: "flex", gap: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#555", minWidth: 100, flexShrink: 0 }}>{row[0]}:</span>
                    <span style={{ fontSize: 9, color: "#222", wordBreak: "break-all" }}>{row[1] || NA}</span>
                  </div>
                )
              })}
              <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "8px 0" }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textAlign: "center", marginBottom: 8 }}>PANTONE / CMYK</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {(d.colors || []).map((col, i) => {
                  if (!col.hex) return null
                  var cm = h2c(col.hex)
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                      <div style={{ width: 18, height: 18, background: col.hex, border: "1px solid #ccc", borderRadius: 2, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#333" }}>{col.name || col.hex}</div>
                        <div style={{ fontSize: 9, color: "#888" }}>
                          C:{cm.c} M:{cm.m} Y:{cm.y} K:{cm.k}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {isEmb2 && d.emb && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ background: "#1a4fd6", color: "white", fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 5, marginBottom: 6, textAlign: "center" }}>{t.embTitle}</div>
                  {[["Maquina", d.emb.machine], ["Puntadas", d.emb.stitches], ["Cam.color", d.emb.colorChanges], ["Paradas", d.emb.stops], ["Cortes", d.emb.trims], ["Tela", d.emb.fabric], ["Estab.Top", d.emb.stabTopping], ["Estab.Back", d.emb.stabBacking], ["Dim.", d.emb.w && d.emb.h ? d.emb.w + "x" + d.emb.h + " mm" : NA], ["Area", d.emb.area ? d.emb.area + " mm2" : NA], ["Max punt.", d.emb.maxStitch ? d.emb.maxStitch + " mm" : NA], ["Min punt.", d.emb.minStitch ? d.emb.minStitch + " mm" : NA], ["Hilo", d.emb.totalThread], ["Bobina", d.emb.totalBobbin]].map((row, i) => (
                    <div key={i} style={{ display: "flex", gap: 4, marginBottom: 3, fontSize: 9 }}>
                      <span style={{ fontWeight: 700, color: "#555", minWidth: 72, flexShrink: 0 }}>{row[0]}:</span>
                      <span style={{ color: "#222" }}>{row[1] || NA}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1, background: "#fafafa", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {d.imageData ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <img src={"data:" + (d.imageType === "svg" ? "image/svg+xml" : "image/png") + ";base64," + d.imageData} style={{ maxWidth: (W - LW2) * 0.7, maxHeight: bodyH * 0.7, objectFit: "contain", display: "block", border: "1px solid #c0392b" }} alt="design" />
                  {(d.w || d.h) && (
                    <div style={{ position: "absolute", bottom: -28, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: "#c0392b" }}>
                      {d.w && <span>W: {d.w}mm</span>}
                      {d.w && d.h && <span> x </span>}
                      {d.h && <span>H: {d.h}mm</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: "center", color: "#ccc", fontSize: 11 }}>
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
