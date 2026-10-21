import { z } from "zod"
import type { ServerSnapshot } from "../../protocol"
import { assertParity } from "../../type-parity"

export const chatIdResultSchema = z.object({ chatId: z.string() })

export const chatSendResultSchema = z.object({
  chatId: z.string(),
  queuedMessageId: z.string().optional(),
  queued: z.literal(true).optional(),
})

export const queuedMessageResultSchema = z.object({ queuedMessageId: z.string() })

export const backgroundTaskOutputReplySchema = z.object({
  type: z.literal("background-task-output"),
  data: z.object({
    chatId: z.string(),
    taskId: z.string(),
    content: z.string(),
    truncated: z.boolean(),
  }),
})

assertParity<z.output<typeof backgroundTaskOutputReplySchema>, Extract<ServerSnapshot, { type: "background-task-output" }>>()
