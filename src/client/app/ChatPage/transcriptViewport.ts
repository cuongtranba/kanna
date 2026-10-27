import type { LegendListRef } from "@legendapp/list/react"
import { runDetached } from "../../lib/runDetached"

export const EMPTY_STATE_TEXT = "What are we building?"
export const EMPTY_STATE_TYPING_INTERVAL_MS = 19
export const CHAT_NAVBAR_OFFSET_PX = 72
export const PANEL_TOGGLE_SETTLE_MS = 350

export function shouldAutoFollowTranscriptResize(
  showScrollButton: boolean,
  selectionAutoFollowUntil: number,
  now = Date.now()
) {
  return !showScrollButton || now < selectionAutoFollowUntil
}

export function hasFileDragTypes(types: Iterable<string>) {
  return Array.from(types).includes("Files")
}

export function scrollTranscriptListToEnd(list: LegendListRef | null, animated: boolean): void {
  const task = list?.scrollToEnd?.({ animated })
  if (task) runDetached("transcript.scrollToEnd", task)
}
