// Google Material Symbols (Sharp variant — angular corners, on-brand with the
// zero-radius Bauhaus system). Replaces every emoji in the UI. Loaded via the
// stylesheet in index.html. Color defaults to currentColor so an icon inherits
// its container's semantic role color.
export function Icon({ name, size = 20, color = "currentColor", weight = 500, fill = false, style }) {
  return (
    <span
      className="material-symbols-sharp"
      aria-hidden="true"
      style={{
        fontSize: size,
        width: size,
        height: size,
        color,
        lineHeight: 1,
        userSelect: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  )
}
