import type { ReactNode } from "react"
import type { PaneLeaf, PaneTabKind, PaneTabTarget } from "../../lib/paneTree"

/**
 * One renderer per tab kind.
 *
 * The target type is narrowed per variant so a terminal renderer always
 * receives `{ kind: "terminal"; terminalId: string }` — no `kind` check
 * needed inside the renderer and `as`-casts are never required.
 */
export type PaneRenderer<T extends PaneTabTarget = PaneTabTarget> = (
  target: T,
  pane: PaneLeaf,
  isFocused: boolean,
) => ReactNode

/**
 * Maps every tab kind to a renderer.
 *
 * Built at ChatPage level (closes over KannaState) and passed to
 * renderPaneContent so each pane can look up its active tab's content
 * without knowing about ChatPage internals.
 *
 * This type replaces:
 *   - ChatWorkspace's 19-prop drill (chat + terminal content)
 *   - the 28-prop rightSidebarContentProps memo (changes content)
 */
export type PaneContentRegistry = {
  readonly [K in PaneTabKind]: PaneRenderer<Extract<PaneTabTarget, { kind: K }>>
}

/**
 * Dispatch: look up the renderer for target.kind and call it.
 *
 * A switch statement guarantees every kind is handled and narrows the
 * target type per branch so no cast is ever needed in a renderer.
 */
export function renderPaneContent(
  registry: PaneContentRegistry,
  target: PaneTabTarget,
  pane: PaneLeaf,
  isFocused: boolean,
): ReactNode {
  switch (target.kind) {
    case "chat":
      return registry.chat(target, pane, isFocused)
    case "changes":
      return registry.changes(target, pane, isFocused)
    case "terminal":
      return registry.terminal(target, pane, isFocused)
  }
}
