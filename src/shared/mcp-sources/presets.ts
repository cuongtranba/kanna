import type { InboundHandler } from "../inbound/handler"
import type { JsonObject } from "../json"

export interface McpSourcePollPreset {
  label: string
  mode: "poll"
  tool: string
  args: JsonObject
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string
  threadKeyPath: string
  senderPath: string
  intervalMs: number
  handler: Pick<InboundHandler, "mode" | "template" | "replyHint" | "pushEnabled">
}

export const MCP_SOURCE_PRESETS: Readonly<Record<"zalo", McpSourcePollPreset>> = {
  zalo: {
    label: "Zalo",
    mode: "poll",
    tool: "zalo_get_messages",
    args: { limit: 50 },
    cursorArg: "since",
    cursorPath: "cursor",
    itemsPath: "messages",
    itemKeyPath: "messageId",
    threadKeyPath: "threadId",
    senderPath: "senderName",
    intervalMs: 15000,
    handler: {
      mode: "spawn",
      template:
        "A new Zalo message arrived in a conversation. Read it, decide whether the user needs to act, and draft a reply in the same language the sender used.",
      replyHint:
        "Send the reply with zalo_send_message using threadId {{threadId}} and threadType {{threadType}} (0 for a direct message, 1 for a group).",
      pushEnabled: true,
    },
  },
}
