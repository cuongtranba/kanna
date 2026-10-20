import { z } from "zod"
import type { RemoteMcpOrigin } from "./command-origin"
import { assertParity } from "./type-parity"

export const remoteMcpOriginSchema = z.object({
  kind: z.literal("remote_mcp"),
  clientId: z.string(),
  clientName: z.string().optional(),
  via: z.enum(["oauth", "password"]),
  tool: z.string(),
  callId: z.string(),
})

assertParity<z.output<typeof remoteMcpOriginSchema>, RemoteMcpOrigin>()
