import { palette, role, type, space } from "../design/tokens.js"

const inputBase = {
  flex: 1,
  width: "100%",
  padding: `${space(2)}px ${space(3)}px`,
  border: `1px solid ${palette.ink.hex}`,
  borderRadius: 0,
  background: palette.white.hex,
  color: palette.ink.hex,
  fontSize: type.size.base,
  fontFamily: type.fonts.ui,
  outline: "none",
  boxSizing: "border-box",
}

export function Inp({ v, ch, ph, mono }) {
  return (
    <input
      value={v}
      onChange={(e) => ch(e.target.value)}
      placeholder={ph || ""}
      style={{
        ...inputBase,
        // Data-shaped inputs (codes, links) use the mono face to match how the
        // same values render on the tech pack.
        fontFamily: mono ? type.fonts.data : type.fonts.ui,
        fontSize: mono ? type.size.sm : type.size.base,
      }}
    />
  )
}

export function Sel({ v, ch, opts }) {
  return (
    <select
      value={v}
      onChange={(e) => ch(e.target.value)}
      style={{ ...inputBase, cursor: "pointer" }}
    >
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  )
}

export function Fld({ lbl, children, span }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space(1), gridColumn: span ? "span " + span : undefined }}>
      <label
        style={{
          fontSize: type.size.xs,
          fontFamily: type.label.family,
          fontWeight: type.label.weight,
          color: palette.ink.hex,
          textTransform: type.label.transform,
          letterSpacing: type.label.tracking,
        }}
      >
        {lbl}
      </label>
      {children}
    </div>
  )
}
