// Ergonomic constructors for layout nodes. All of these just return plain
// objects matching the shape solveLayout()/renderLayoutToSVG() expect -
// there is no hidden state or class, so trees are easy to build, inspect in
// tests, and compose.

let _autoId = 0
const nextId = () => "n" + ++_autoId

/**
 * @typedef {object} LayoutNode
 * @property {string} [id]
 * @property {number} [grow]      flex-grow, relative to siblings. Default 0.
 * @property {number} [shrink]    flex-shrink, relative to siblings. Default 1.
 * @property {number|'auto'} [basis]  preferred main-axis size in px. Default 'auto' (0).
 * @property {number} [min]       min main-axis size in px. Default 0.
 * @property {number} [max]       max main-axis size in px. Default Infinity.
 * @property {number} [crossBasis] explicit cross-axis size (only used when align isn't 'stretch').
 * @property {'row'|'column'} [direction]  how *my* children are laid out. Default 'row'.
 * @property {number|object} [padding]
 * @property {number} [gap]
 * @property {'start'|'center'|'end'|'stretch'} [align]    cross-axis alignment of children. Default 'stretch'.
 * @property {'start'|'center'|'end'|'space-between'} [justify]  main-axis distribution. Default 'start'.
 * @property {LayoutNode[]} [children]
 * @property {(resolvedBox: {x:number,y:number,width:number,height:number}) => string} [render]
 *   Only meaningful on leaf nodes (no children). Called by renderLayoutToSVG().
 */

/** A flex container laid out left-to-right. */
export function row(props, children) {
  return { id: nextId(), direction: "row", ...props, children: children || [] }
}

/** A flex container laid out top-to-bottom. */
export function col(props, children) {
  return { id: nextId(), direction: "column", ...props, children: children || [] }
}

/** A leaf region with no children — just sizing props and a render function. */
export function leaf(props) {
  return { id: nextId(), ...props, children: [] }
}
