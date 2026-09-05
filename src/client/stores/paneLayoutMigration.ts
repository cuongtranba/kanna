import {
  createGroup,
  createPane,
  createTab,
  type PaneLayout,
  type PaneNode,
} from "../lib/paneTree"


export interface LegacyTerminal {
  id: string
}

export interface LegacyProjectLayout {
  terminals: readonly LegacyTerminal[]
  mainSizes: readonly [number, number]
  terminalSizes: readonly number[]
  changesVisible: boolean
  changesSizePercent: number
}

const CHAT_PANE_ID = "main"
const CHANGES_PANE_ID = "changes"
const WORKSPACE_GROUP_ID = "workspace"
const TERMINALS_GROUP_ID = "terminals"
const ROOT_GROUP_ID = "root"

function percentToFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return fallback
  return value / 100
}

export function buildLayoutFromLegacy(legacy: LegacyProjectLayout): PaneLayout {
  const chatPane = createPane(CHAT_PANE_ID, [])

  const terminals = legacy.terminals.filter((terminal) => terminal.id.trim().length > 0)

  const terminalPanes = terminals.map((terminal, index) =>
    createPane(`terminal-${terminal.id}`, [
      createTab({ kind: "terminal", terminalId: terminal.id.trim() }, index),
    ]),
  )

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
