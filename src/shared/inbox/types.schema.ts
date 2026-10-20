import { z } from "zod"
import type { InboxFilter } from "./types"
import { assertParity } from "../type-parity"

export const inboxFilterSchema = z.object({
  sourceKind: z.enum(["store", "transcript", "webhook", "mcp", "inbox"]).optional(),
  projectId: z.string().optional(),
  chatId: z.string().optional(),
  attentionOnly: z.boolean().optional(),
})

assertParity<z.output<typeof inboxFilterSchema>, InboxFilter>()
