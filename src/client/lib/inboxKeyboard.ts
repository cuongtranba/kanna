import type { KeybindingAction } from "../../shared/app-settings-types"
import type { InboxRecord } from "./inboxFilter"

export type InboxKeyCommand = "nextThread" | "prevThread" | "focusComposer" | "archiveThread" | "approveProposal"

export const INBOX_KEY_COMMANDS: ReadonlyArray<readonly [KeybindingAction, InboxKeyCommand]> = [
  ["inboxNextThread", "nextThread"],
  ["inboxPrevThread", "prevThread"],
  ["inboxFocusComposer", "focusComposer"],
  ["inboxArchiveThread", "archiveThread"],
  ["inboxApproveProposal", "approveProposal"],
]

export function adjacentThreadId(records: readonly InboxRecord[], selectedId: string | null, delta: 1 | -1): string | null {
  const ids = records.flatMap((record) => (record.kind === "thread" ? [record.id] : []))
  if (ids.length === 0) return null
  const index = selectedId === null ? -1 : ids.indexOf(selectedId)
  if (index === -1) return delta === 1 ? (ids[0] ?? null) : (ids.at(-1) ?? null)
  return ids[index + delta] ?? null
}
