import { z } from "zod"
import type { MintRequest, RevokeRequest } from "./types"
import { assertParity } from "../type-parity"

export const mintRequestSchema = z.object({ chatId: z.string(), ttlHours: z.number().optional() })
export const revokeRequestSchema = z.object({ tokenId: z.string() })
export const shareListRequestSchema = z.object({ chatId: z.string() })

assertParity<z.output<typeof mintRequestSchema>, MintRequest>()
assertParity<z.output<typeof revokeRequestSchema>, RevokeRequest>()
