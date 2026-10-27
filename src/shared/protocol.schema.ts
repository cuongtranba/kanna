import { z } from "zod"
import { isJsonObject, type JsonValue } from "./json"
import type { ClientEnvelope, SubscriptionTopic } from "./protocol"
import type { BoardOwnerKind } from "./boards/types"
import { assertParity } from "./type-parity"

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
  z.object({ type: z.literal("service-bus") }),
])

assertParity<z.output<typeof subscriptionTopicSchema>, SubscriptionTopic>()

const subscribeEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal("subscribe"),
  id: z.string(),
  topic: subscriptionTopicSchema,
})

const unsubscribeEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal("unsubscribe"),
  id: z.string(),
})

const commandEnvelopeHeaderSchema = z.object({
  v: z.literal(1),
  type: z.literal("command"),
  id: z.string(),
})

assertParity<z.output<typeof subscribeEnvelopeSchema>, Extract<ClientEnvelope, { type: "subscribe" }>>()
assertParity<z.output<typeof unsubscribeEnvelopeSchema>, Extract<ClientEnvelope, { type: "unsubscribe" }>>()

const clientEnvelopeSchema = z.discriminatedUnion("type", [
  subscribeEnvelopeSchema,
  unsubscribeEnvelopeSchema,
  commandEnvelopeHeaderSchema,
])

export type ParsedClientEnvelope =
  | z.output<typeof subscribeEnvelopeSchema>
  | z.output<typeof unsubscribeEnvelopeSchema>
  | (z.output<typeof commandEnvelopeHeaderSchema> & { command: JsonValue })

export function parseClientEnvelope(value: JsonValue): ParsedClientEnvelope | null {
  const result = clientEnvelopeSchema.safeParse(value)
  if (!result.success) return null
  const envelope = result.data
  if (envelope.type !== "command") return envelope
  return { ...envelope, command: isJsonObject(value) ? (value.command ?? null) : null }
}
