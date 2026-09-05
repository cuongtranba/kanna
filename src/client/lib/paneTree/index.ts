
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

export { KEYBOARD_RESIZE_STEP, findResizeBoundary, type PaneResizeBoundary } from "./resize"

export { normalizeLayout } from "./normalize"
