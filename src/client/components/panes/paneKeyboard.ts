import type { KeybindingAction, KeybindingsSnapshot } from "../../../shared/app-settings-types"
import { findMatchingActionBinding } from "../../lib/keybindings"
import type { PaneDirection, SplitPosition } from "../../lib/paneTree"

/**
 * The one place a keyboard event becomes a pane intent.
 *
 * Pure on purpose: the ChatPage listener stays a thin adapter that asks this
 * module what the user meant and hands the answer to a store action, so the
 * whole keyboard surface is unit-testable without a DOM.
 */

export type PaneCommand =
  | { kind: "focus"; direction: PaneDirection }
  | { kind: "split"; position: SplitPosition }
  | { kind: "closeTab" }
  /** +1 is the next tab in the focused pane, -1 the previous; both wrap. */
  | { kind: "cycleTab"; delta: 1 | -1 }

/** Ordered so the first match wins; bindings are expected to be disjoint. */
const PANE_COMMANDS: ReadonlyArray<readonly [KeybindingAction, PaneCommand]> = [
  ["focusPaneLeft", { kind: "focus", direction: "left" }],
  ["focusPaneRight", { kind: "focus", direction: "right" }],
  ["focusPaneUp", { kind: "focus", direction: "up" }],
  ["focusPaneDown", { kind: "focus", direction: "down" }],
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

/**
 * Anything whose keystrokes belong to the user, not to us.
 *
 * Takes the narrowed shape rather than an `EventTarget` so it stays testable
 * without a DOM; the caller does the `instanceof HTMLElement` narrowing.
 */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false
  if (target.isContentEditable) return true

  const tag = target.tagName?.toUpperCase()
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/**
 * Which pane command this event means, if any.
 *
 * `typing` only suppresses MODIFIER-LESS bindings. Every default is a modifier
 * combo, and a terminal or the composer holds focus most of the time — blanket
 * suppression would make pane navigation unreachable from precisely where it is
 * needed. But a user may rebind to a bare letter, and that must never eat their
 * keystrokes.
 */
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
