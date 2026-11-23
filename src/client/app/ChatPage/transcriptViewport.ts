import type { LegendListRef } from "@legendapp/list/react"
import { runDetached } from "../../lib/runDetached"

export const EMPTY_STATE_TEXT = "What are we building?"
export const EMPTY_STATE_TYPING_INTERVAL_MS = 19
export const CHAT_NAVBAR_OFFSET_PX = 72
export const PANEL_TOGGLE_SETTLE_MS = 350
export const TRANSCRIPT_TOUCH_HOLD_LIMIT_PX = 2000

const TRANSCRIPT_END_EDGE_PX = 4

export function isTranscriptPinnedToEnd(list: LegendListRef | null, scrollNode: HTMLElement | null): boolean | null {
  const state = list?.getState?.()
  if (state?.isFollowingEnd) return true
  if (scrollNode) {
    return scrollNode.scrollHeight - scrollNode.clientHeight - scrollNode.scrollTop <= TRANSCRIPT_END_EDGE_PX
  }
  return state ? state.isAtEnd : null
}

export function hasFileDragTypes(types: Iterable<string>) {
  return Array.from(types).includes("Files")
}

export function scrollTranscriptListToEnd(list: LegendListRef | null, animated: boolean): void {
  const task = list?.scrollToEnd?.({ animated })
  if (task) runDetached("transcript.scrollToEnd", task)
}
