import {
  createGroup,
  createPane,
  createTab,
  type PaneLayout,
  type PaneNode,
} from "../lib/paneTree"

/**
 * One-time seed of the pane tree from the layout state Kanna kept before tabs.
 *
 * This is a cross-key migration, not a zustand version bump: the old layout
 * lived in two separate localStorage entries ("terminal-layouts" and
 * "right-sidebar-layouts") with different scoping rules, and the tree replaces
 * both. The seed is a pure function so it can be table-tested against real
 * legacy shapes before anyone's saved layout depends on it.
 *
 * The old arrangement is preserved rather than flattened into tabs — a user who
 * had three terminals side by side under their chat still has them, so nobody
 * loses a layout they built by upgrading.
 */

export interface LegacyTerminal {
  id: string
}

export interface LegacyProjectLayout {
  terminals: readonly LegacyTerminal[]
  /** [chat%, terminal%] of the workspace column. */
  mainSizes: readonly [number, number]
  /** Per-terminal widths, as percentages. */
  terminalSizes: readonly number[]
  changesVisible: boolean
  /** Width of the git panel, as a percentage of the whole page. */
  changesSizePercent: number
}

const CHAT_PANE_ID = "main"
const CHANGES_PANE_ID = "changes"
const WORKSPACE_GROUP_ID = "workspace"
const TERMINALS_GROUP_ID = "terminals"
const ROOT_GROUP_ID = "root"

/** Percentages from localStorage may be anything; fall back rather than trust. */
function percentToFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return fallback
  return value / 100
}

export function buildLayoutFromLegacy(legacy: LegacyProjectLayout): PaneLayout {
  const chatPane = createPane(CHAT_PANE_ID, [createTab({ kind: "chat" }, 0)])

  const terminals = legacy.terminals.filter((terminal) => terminal.id.trim().length > 0)

  const terminalPanes = terminals.map((terminal, index) =>
    createPane(`terminal-${terminal.id}`, [
      createTab({ kind: "terminal", terminalId: terminal.id.trim() }, index),
    ]),
  )

  // Terminals were a horizontal strip; keep them as sibling panes so the
  // arrangement survives the upgrade. createGroup collapses the single-terminal
  // case to that one pane, so no group is created needlessly.
  const terminalNode: PaneNode | null =
    terminalPanes.length > 0
      ? createGroup(TERMINALS_GROUP_ID, "horizontal", terminalPanes, [...legacy.terminalSizes])
      : null

  const chatFraction = percentToFraction(legacy.mainSizes[0], 0.68)
  const workspace: PaneNode = terminalNode
    ? createGroup(WORKSPACE_GROUP_ID, "vertical", [chatPane, terminalNode], [
        chatFraction,
        1 - chatFraction,
      ])
    : chatPane

  if (!legacy.changesVisible) {
    return { root: workspace, focusedPaneId: CHAT_PANE_ID }
  }

  const changesFraction = percentToFraction(legacy.changesSizePercent, 0.33)
  const changesPane = createPane(CHANGES_PANE_ID, [createTab({ kind: "changes" }, 0)])

  return {
    root: createGroup(ROOT_GROUP_ID, "horizontal", [workspace, changesPane], [
      1 - changesFraction,
      changesFraction,
    ]),
    focusedPaneId: CHAT_PANE_ID,
  }
}
