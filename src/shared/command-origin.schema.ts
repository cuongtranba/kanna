import { z } from "zod"
import type { CommandOrigin, PeerChatOrigin, RemoteMcpOrigin } from "./command-origin"
import { assertParity } from "./type-parity"

export const remoteMcpOriginSchema = z.object({
  kind: z.literal("remote_mcp"),
  clientId: z.string(),
  clientName: z.string().optional(),
  via: z.enum(["oauth", "password"]),
  tool: z.string(),
  callId: z.string(),
})

export const peerChatOriginSchema = z.object({
  kind: z.literal("peer_chat"),
  fromChatId: z.string(),
  fromTitle: z.string(),
  fromProjectId: z.string(),
  fromProjectTitle: z.string(),
  messageId: z.string(),
  fromRunId: z.string().optional(),
  fromSubagentName: z.string().optional(),
  inReplyTo: z.string().optional(),
})

export const commandOriginSchema = z.discriminatedUnion("kind", [remoteMcpOriginSchema, peerChatOriginSchema])

assertParity<z.output<typeof remoteMcpOriginSchema>, RemoteMcpOrigin>()
assertParity<z.output<typeof peerChatOriginSchema>, PeerChatOrigin>()
assertParity<z.output<typeof commandOriginSchema>, CommandOrigin>()
