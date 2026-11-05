import type { McpSourceInput } from "./types"

type PresetTemplate<Input> = Input extends McpSourceInput ? Omit<Input, "name" | "serverId" | "enabled"> : never

export type McpSourcePreset = PresetTemplate<McpSourceInput> & { label: string }

export const MCP_SOURCE_PRESET_IDS = ["zalo"] as const
export type McpSourcePresetId = (typeof MCP_SOURCE_PRESET_IDS)[number]

const ZALO_RESYNC_MS = 300_000

export const MCP_SOURCE_PRESETS: Readonly<Record<McpSourcePresetId, McpSourcePreset>> = {
  zalo: {
    label: "Zalo",
    mode: "subscribe",
    resourceUris: ["zalo://inbox"],
    itemsPath: "messages",
    itemKeyPath: "id",
    resyncIntervalMs: ZALO_RESYNC_MS,
    threadKeyPath: "threadId",
    senderPath: "senderName",
    handler: {
      mode: "spawn",
      template:
        "A new Zalo message arrived in a conversation. Read it, decide whether the user needs to act, and draft a reply in the same language the sender used.",
      replyHint:
        'Send the reply with zalo_send_message using threadId {{threadId}} and threadType {{threadType}}: pass 0 when threadType is "dm" and 1 when it is "group".',
      pushEnabled: true,
    },
  },
}
