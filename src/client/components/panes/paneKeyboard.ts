import type { KeybindingAction, KeybindingsSnapshot } from "../../../shared/app-settings-types"
import { findMatchingActionBinding } from "../../lib/keybindings"
import type { PaneDirection, SplitPosition } from "../../lib/paneTree"


export type PaneCommand =
  | { kind: "focus"; direction: PaneDirection }
  | { kind: "resize"; direction: PaneDirection }
  | { kind: "split"; position: SplitPosition }
  | { kind: "closeTab" }
  | { kind: "cycleTab"; delta: 1 | -1 }

const PANE_COMMANDS: ReadonlyArray<readonly [KeybindingAction, PaneCommand]> = [
  ["focusPaneLeft", { kind: "focus", direction: "left" }],
  ["focusPaneRight", { kind: "focus", direction: "right" }],
  ["focusPaneUp", { kind: "focus", direction: "up" }],
  ["focusPaneDown", { kind: "focus", direction: "down" }],
  ["resizePaneLeft", { kind: "resize", direction: "left" }],
  ["resizePaneRight", { kind: "resize", direction: "right" }],
  ["resizePaneUp", { kind: "resize", direction: "up" }],
  ["resizePaneDown", { kind: "resize", direction: "down" }],
  ["splitPaneRight", { kind: "split", position: "right" }],
  ["splitPaneDown", { kind: "split", position: "bottom" }],
  ["closePaneTab", { kind: "closeTab" }],
  ["nextPaneTab", { kind: "cycleTab", delta: 1 }],
  ["previousPaneTab", { kind: "cycleTab", delta: -1 }],
]

const MODIFIER_TOKENS = new Set(["cmd", "meta", "ctrl", "control", "alt", "option", "shift"])

function bindingHasModifier(binding: string): boolean {
  return binding
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .some((token) => MODIFIER_TOKENS.has(token))
}

export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false
  if (target.isContentEditable) return true

  const tag = target.tagName?.toUpperCase()
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

export function resolvePaneCommand(
  keybindings: KeybindingsSnapshot | null,
  event: KeyboardEvent,
  typing: boolean,
): PaneCommand | null {
  for (const [action, command] of PANE_COMMANDS) {
    const binding = findMatchingActionBinding(keybindings, action, event)
    if (!binding) continue
    if (typing && !bindingHasModifier(binding)) return null
    return command
  }

  return null
}
