/**
 * The pane tree: a pure, DOM-free model of a tab + split-pane layout.
 *
 * Every operation is a pure function returning `null` when it changes nothing,
 * so the store can preserve referential identity. Ids for newly created nodes
 * are passed in rather than generated, which keeps the whole engine
 * deterministic and unit-testable.
 */

export {
  MAX_TREE_DEPTH,
  DEFAULT_PANE_ID,
  isGroup,
  isPane,
  type NodeIdSource,
  type PaneLayout,
  type PaneLeaf,
  type PaneGroup,
  type PaneNode,
  type PaneTab,
  type PaneTabKind,
  type PaneTabTarget,
  type SplitDirection,
  type SplitPosition,
} from "./types"

export { MIN_PANE_FRACTION, clampPairSizes, normalizeSizes, redistributeToMinimum } from "./sizes"

export { buildTabId, isSingletonTabKind, normalizeTabTarget, tabTargetsEqual } from "./tabTarget"

export {
  collectPanes,
  createDefaultLayout,
  createGroup,
  createPane,
  createTab,
  detachTab,
  findNearestSiblingPaneId,
  findPaneContainingTab,
  findPanePath,
  getNodeAtPath,
  getTreeDepth,
  insertTabIntoPane,
  removePaneByPath,
  replaceNodeAtPath,
  type DetachTabResult,
} from "./tree"

export {
  closeTab,
  focusPane,
  focusTab,
  moveTabToPane,
  openTab,
  reorderPaneTabs,
  resizeGroup,
  setGroupSizes,
  splitPane,
  type OpenTabResult,
  type SplitPaneArgs,
} from "./operations"

export {
  collectPaneBounds,
  findAdjacentPane,
  type PaneBounds,
  type PaneDirection,
  type PaneRect,
} from "./navigation"

export { normalizeLayout } from "./normalize"

export {
  openPane,
  closePane,
  selectPane,
  nextPane,
  prevPane,
  type Pane,
  type PaneTree,
} from "./sessionPanes"
