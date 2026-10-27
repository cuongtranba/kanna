const TERMINAL_PANE_INLINE_PADDING = 12

export const TERMINAL_PANE_PADDING_STYLE = { paddingInline: TERMINAL_PANE_INLINE_PADDING } as const

export function getMinimumTerminalWidth(minColumnWidth: number) {
  return minColumnWidth + TERMINAL_PANE_INLINE_PADDING * 2
}

export function getMinimumTerminalWorkspaceWidth(paneCount: number, minColumnWidth: number) {
  return Math.max(1, paneCount) * getMinimumTerminalWidth(minColumnWidth)
}
