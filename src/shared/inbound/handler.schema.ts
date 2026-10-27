import { z } from "zod"
import { INBOUND_HANDLER_MODES, INBOUND_HANDLINGS, type InboundHandler } from "./handler"
import { agentProviderSchema } from "../core-types.schema"
import { assertParity } from "../type-parity"

export const inboundHandlerModeSchema = z.enum(INBOUND_HANDLER_MODES)

export const inboundHandlingSchema = z.enum(INBOUND_HANDLINGS)

export const inboundHandlerSchema = z.object({
  mode: inboundHandlerModeSchema,
  handling: inboundHandlingSchema.optional(),
  chatId: z.string().optional(),
  projectId: z.string().optional(),
  template: z.string(),
  replyHint: z.string(),
  pushEnabled: z.boolean(),
  provider: agentProviderSchema.optional(),
  model: z.string().optional(),
})

assertParity<z.output<typeof inboundHandlerSchema>, InboundHandler>()
