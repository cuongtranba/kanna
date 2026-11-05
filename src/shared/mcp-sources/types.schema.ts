import { z } from "zod"
import { MCP_SOURCE_MODES, type McpSource, type McpSourceInput, type McpSourcePatch } from "./types"
import { jsonObjectSchema, jsonValueSchema } from "../genui/json-schema"
import { inboundHandlerSchema } from "../inbound/handler.schema"
import { INBOX_AUTONOMY_LEVELS } from "../inbox/autonomy"
import { assertParity } from "../type-parity"

export const mcpSourceModeSchema = z.enum(MCP_SOURCE_MODES)

const mcpReplyArgSchema = z.union([
  z.string(),
  z.object({ from: z.string(), map: jsonObjectSchema, default: jsonValueSchema.optional() }),
])

export const mcpSourceReplySchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), mcpReplyArgSchema),
  resultIdPath: z.string(),
})

export const mcpSourceAutonomySchema = z.object({
  level: z.enum(INBOX_AUTONOMY_LEVELS),
  threshold: z.number(),
  perThreadPerHour: z.number(),
  perSourcePerDay: z.number(),
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
  allowlist: z.array(z.string()),
  allowUrls: z.boolean(),
  maxChars: z.number(),
  sendDelaySeconds: z.number(),
})

const mcpSourceAutonomyPartialSchema = mcpSourceAutonomySchema.partial()

const mcpSourceInputBaseShape = {
  name: z.string(),
  serverId: z.string(),
  enabled: z.boolean().optional(),
  threadKeyPath: z.string(),
  senderPath: z.string(),
  textPath: z.string().optional(),
  handler: inboundHandlerSchema,
  reply: mcpSourceReplySchema.nullable().optional(),
  autonomy: mcpSourceAutonomyPartialSchema.optional(),
}

const subscribeInputFieldsShape = {
  mode: z.literal("subscribe"),
  resourceUris: z.array(z.string()),
  itemsPath: z.string().optional(),
  itemKeyPath: z.string().nullable().optional(),
  resyncIntervalMs: z.number().nullable().optional(),
}

const subscribeFieldsShape = {
  mode: z.literal("subscribe"),
  resourceUris: z.array(z.string()),
  itemsPath: z.string(),
  itemKeyPath: z.string().nullable(),
  resyncIntervalMs: z.number().nullable(),
}

const pollFieldsShape = {
  mode: z.literal("poll"),
  tool: z.string(),
  args: jsonObjectSchema,
  cursorArg: z.string(),
  cursorPath: z.string(),
  itemsPath: z.string(),
  itemKeyPath: z.string().nullable(),
  intervalMs: z.number(),
}

export const mcpSourceInputSchema = z.discriminatedUnion("mode", [
  z.object({ ...mcpSourceInputBaseShape, ...subscribeInputFieldsShape }),
  z.object({ ...mcpSourceInputBaseShape, ...pollFieldsShape }),
])

const mcpSourceBaseShape = {
  id: z.string(),
  name: z.string(),
  serverId: z.string(),
  enabled: z.boolean(),
  threadKeyPath: z.string(),
  senderPath: z.string(),
  textPath: z.string(),
  handler: inboundHandlerSchema,
  reply: mcpSourceReplySchema.nullable(),
  autonomy: mcpSourceAutonomySchema,
  createdAt: z.number(),
  updatedAt: z.number(),
}

export const mcpSourceSchema = z.discriminatedUnion("mode", [
  z.object({ ...mcpSourceBaseShape, ...subscribeFieldsShape }),
  z.object({ ...mcpSourceBaseShape, ...pollFieldsShape }),
])

export const mcpSourcePatchSchema = z.object({
  name: z.string().optional(),
  serverId: z.string().optional(),
  enabled: z.boolean().optional(),
  mode: mcpSourceModeSchema.optional(),
  threadKeyPath: z.string().optional(),
  senderPath: z.string().optional(),
  textPath: z.string().optional(),
  handler: inboundHandlerSchema.optional(),
  reply: mcpSourceReplySchema.nullable().optional(),
  autonomy: mcpSourceAutonomyPartialSchema.optional(),
  resourceUris: z.array(z.string()).optional(),
  tool: z.string().optional(),
  args: jsonObjectSchema.optional(),
  cursorArg: z.string().optional(),
  cursorPath: z.string().optional(),
  itemsPath: z.string().optional(),
  itemKeyPath: z.string().nullable().optional(),
  intervalMs: z.number().optional(),
  resyncIntervalMs: z.number().nullable().optional(),
})

assertParity<z.output<typeof mcpSourceInputSchema>, McpSourceInput>()
assertParity<z.output<typeof mcpSourcePatchSchema>, McpSourcePatch>()
assertParity<z.output<typeof mcpSourceSchema>, McpSource>()
