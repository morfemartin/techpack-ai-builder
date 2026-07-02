export function Inp({ v, ch, ph, mono }) {
  return (
    <input
      value={v}
      onChange={(e) => ch(e.target.value)}
      placeholder={ph || ""}
      style={{ flex: 1, padding: "6px 10px", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: mono ? 11 : 13, fontFamily: mono ? "monospace" : "inherit", outline: "none", boxSizing: "border-box", width: "100%" }}
    />
  )
}

export function Sel({ v, ch, opts }) {
  return (
    <select value={v} onChange={(e) => ch(e.target.value)} style={{ padding: "6px 10px", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: 13, background: "white", outline: "none" }}>
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  )
}

export function Fld({ lbl, children, span }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: span ? "span " + span : undefined }}>
      <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 0.5 }}>{lbl}</label>
      {children}
    </div>
  )
}
