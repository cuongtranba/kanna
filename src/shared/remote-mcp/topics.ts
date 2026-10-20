import { z } from "zod"
import type { JsonValue } from "../json"
import type { SubscriptionTopic } from "../protocol"
import type { BoardOwnerKind } from "../boards/types"

const BOARD_OWNER_KIND_VALUES = ["project", "stack"] as const satisfies readonly BoardOwnerKind[]

export const subscriptionTopicSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sidebar") }),
  z.object({ type: z.literal("local-projects") }),
  z.object({ type: z.literal("update") }),
  z.object({ type: z.literal("keybindings") }),
  z.object({ type: z.literal("app-settings") }),
  z.object({ type: z.literal("push-config") }),
  z.object({
    type: z.literal("chat"),
    chatId: z.string(),
    recentLimit: z.number().optional(),
    since: z.number().optional(),
  }),
  z.object({ type: z.literal("project-git"), projectId: z.string(), chatId: z.string().optional() }),
  z.object({ type: z.literal("project-commands"), projectId: z.string() }),
  z.object({ type: z.literal("terminal"), terminalId: z.string() }),
  z.object({ type: z.literal("workflows"), chatId: z.string() }),
  z.object({
    type: z.literal("boards"),
    ownerKind: z.enum(BOARD_OWNER_KIND_VALUES),
    ownerId: z.string(),
  }),
  z.object({ type: z.literal("board"), boardId: z.string(), pageSize: z.number().optional() }),
  z.object({ type: z.literal("followed-sessions") }),
  z.object({ type: z.literal("cron-jobs") }),
  z.object({ type: z.literal("beacons") }),
  z.object({ type: z.literal("background-task-output"), chatId: z.string(), taskId: z.string() }),
  z.object({ type: z.literal("package-updates") }),
  z.object({ type: z.literal("webhooks") }),
  z.object({ type: z.literal("inbox") }),
  z.object({ type: z.literal("mcp-sources") }),
])

function toTopic(parsed: z.infer<typeof subscriptionTopicSchema>): SubscriptionTopic {
  return parsed
}

export function parseSubscriptionTopic(value: JsonValue): SubscriptionTopic | null {
  const result = subscriptionTopicSchema.safeParse(value)
  return result.success ? toTopic(result.data) : null
}
