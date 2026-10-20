import { z } from "zod"
import type { InboundHandler, InboundHandlerMode } from "./handler"
import { agentProviderSchema } from "../core-types.schema"
import { assertParity } from "../type-parity"

export const inboundHandlerModeSchema = z.enum(["notify", "inline", "spawn"])

export const inboundHandlerSchema = z.object({
  mode: inboundHandlerModeSchema,
  chatId: z.string().optional(),
  projectId: z.string().optional(),
  template: z.string(),
  replyHint: z.string(),
  pushEnabled: z.boolean(),
  provider: agentProviderSchema.optional(),
  model: z.string().optional(),
})

assertParity<z.output<typeof inboundHandlerModeSchema>, InboundHandlerMode>()
assertParity<z.output<typeof inboundHandlerSchema>, InboundHandler>()
