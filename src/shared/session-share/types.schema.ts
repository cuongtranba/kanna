import { z } from "zod"
import type { MintRequest, RevokeRequest } from "./types"
import type { ShareCommandResult } from "./protocol"
import { assertParity } from "../type-parity"

export const mintRequestSchema = z.object({ chatId: z.string(), ttlHours: z.number().optional() })
export const revokeRequestSchema = z.object({ tokenId: z.string() })
export const shareListRequestSchema = z.object({ chatId: z.string() })

const shareErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat_not_found"), chatId: z.string() }),
  z.object({ kind: z.literal("snapshot_too_large"), sizeBytes: z.number() }),
  z.object({ kind: z.literal("snapshot_write_failed"), message: z.string() }),
  z.object({ kind: z.literal("not_found") }),
  z.object({ kind: z.literal("revoked") }),
  z.object({ kind: z.literal("expired"), expiredAt: z.number() }),
  z.object({ kind: z.literal("snapshot_read_failed"), message: z.string() }),
])

const shareSummarySchema = z.object({
  tokenId: z.string(),
  chatId: z.string(),
  url: z.string(),
  expiresAt: z.number(),
  createdAt: z.number(),
  revoked: z.boolean(),
})

const shareFailureSchema = z.object({ ok: z.literal(false), error: shareErrorSchema })

export const shareMintResultSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal("mint"), data: z.object({ summary: shareSummarySchema }) }),
  shareFailureSchema,
])

export const shareRevokeResultSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal("revoke"), data: z.object({ tokenId: z.string() }) }),
  shareFailureSchema,
])

export const shareListResultSchema = z.object({
  ok: z.literal(true),
  kind: z.literal("list"),
  data: z.object({ shares: z.array(shareSummarySchema) }),
})

assertParity<
  z.output<typeof shareMintResultSchema> | z.output<typeof shareRevokeResultSchema> | z.output<typeof shareListResultSchema>,
  ShareCommandResult
>()
assertParity<z.output<typeof mintRequestSchema>, MintRequest>()
assertParity<z.output<typeof revokeRequestSchema>, RevokeRequest>()
