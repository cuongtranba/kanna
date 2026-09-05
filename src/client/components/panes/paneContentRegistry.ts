import type { ReactNode } from "react"
import type { PaneLeaf, PaneTabKind, PaneTabTarget } from "../../lib/paneTree"

export type PaneRenderer<T extends PaneTabTarget = PaneTabTarget> = (
  target: T,
  pane: PaneLeaf,
  isFocused: boolean,
  isActiveTab: boolean,
) => ReactNode

export type PaneContentRegistry = {
  readonly [K in PaneTabKind]: PaneRenderer<Extract<PaneTabTarget, { kind: K }>>
}

export function renderPaneContent(
  registry: PaneContentRegistry,
  target: PaneTabTarget,
  pane: PaneLeaf,
  isFocused: boolean,
  isActiveTab: boolean,
): ReactNode {
  switch (target.kind) {
    case "chat":
      return registry.chat(target, pane, isFocused, isActiveTab)
    case "changes":
      return registry.changes(target, pane, isFocused, isActiveTab)
    case "terminal":
      return registry.terminal(target, pane, isFocused, isActiveTab)
    case "board":
      return registry.board(target, pane, isFocused, isActiveTab)
  }
}
