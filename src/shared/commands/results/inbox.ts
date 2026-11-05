import { z } from "zod"

export const inboxReplyResultSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("direct"), outboundId: z.string() }),
  z.object({ mode: z.literal("agent"), chatId: z.string() }),
])

export const inboxOutboundIdResultSchema = z.object({ outboundId: z.string() })
