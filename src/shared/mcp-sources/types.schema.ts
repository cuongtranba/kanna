import { z } from "zod"
import type { McpSourceInput, McpSourceMode, McpSourcePatch } from "./types"
import { jsonObjectSchema } from "../genui/json-schema"
import { inboundHandlerSchema } from "../inbound/handler.schema"
import { assertParity } from "../type-parity"

export const mcpSourceModeSchema = z.enum(["subscribe", "poll"])

const mcpSourceInputBaseShape = {
  name: z.string(),
  serverId: z.string(),
  enabled: z.boolean().optional(),
  threadKeyPath: z.string(),
  senderPath: z.string(),
  handler: inboundHandlerSchema,
}

export const mcpSourceInputSchema = z.discriminatedUnion("mode", [
  z.object({ ...mcpSourceInputBaseShape, mode: z.literal("subscribe"), resourceUris: z.array(z.string()) }),
  z.object({
    ...mcpSourceInputBaseShape,
    mode: z.literal("poll"),
    tool: z.string(),
    args: jsonObjectSchema,
    cursorArg: z.string(),
    cursorPath: z.string(),
    itemsPath: z.string(),
    itemKeyPath: z.string().nullable(),
    intervalMs: z.number(),
  }),
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

assertParity<z.output<typeof mcpSourceModeSchema>, McpSourceMode>()
assertParity<z.output<typeof mcpSourceInputSchema>, McpSourceInput>()
assertParity<z.output<typeof mcpSourcePatchSchema>, McpSourcePatch>()
