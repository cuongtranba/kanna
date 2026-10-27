import { z } from "zod"
import { MCP_SOURCE_MODES, type McpSource, type McpSourceInput, type McpSourcePatch } from "./types"
import { jsonObjectSchema } from "../genui/json-schema"
import { inboundHandlerSchema } from "../inbound/handler.schema"
import { assertParity } from "../type-parity"

export const mcpSourceModeSchema = z.enum(MCP_SOURCE_MODES)

const mcpSourceInputBaseShape = {
  name: z.string(),
  serverId: z.string(),
  enabled: z.boolean().optional(),
  threadKeyPath: z.string(),
  senderPath: z.string(),
  handler: inboundHandlerSchema,
}

const subscribeFieldsShape = { mode: z.literal("subscribe"), resourceUris: z.array(z.string()) }

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
  z.object({ ...mcpSourceInputBaseShape, ...subscribeFieldsShape }),
  z.object({ ...mcpSourceInputBaseShape, ...pollFieldsShape }),
])

const mcpSourceBaseShape = {
  id: z.string(),
  name: z.string(),
  serverId: z.string(),
  enabled: z.boolean(),
  threadKeyPath: z.string(),
  senderPath: z.string(),
  handler: inboundHandlerSchema,
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
  handler: inboundHandlerSchema.optional(),
  resourceUris: z.array(z.string()).optional(),
  tool: z.string().optional(),
  args: jsonObjectSchema.optional(),
  cursorArg: z.string().optional(),
  cursorPath: z.string().optional(),
  itemsPath: z.string().optional(),
  itemKeyPath: z.string().nullable().optional(),
  intervalMs: z.number().optional(),
})

assertParity<z.output<typeof mcpSourceInputSchema>, McpSourceInput>()
assertParity<z.output<typeof mcpSourcePatchSchema>, McpSourcePatch>()
assertParity<z.output<typeof mcpSourceSchema>, McpSource>()
