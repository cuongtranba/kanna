import type { PushAction } from "../types"

export const INBOX_PUSH_PREVIEW_MAX_CHARS = 140
export const INBOX_PUSH_PROPOSAL_BODY = "Agent wants to reply"
export const INBOX_PUSH_SEND_ACTION: PushAction = { action: "send", title: "Send" }

export function inboxPushPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, INBOX_PUSH_PREVIEW_MAX_CHARS)
}
