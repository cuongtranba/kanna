import { z } from "zod"
import type { ChatAttachment, PushSubscribeRequestPayload } from "./types"
import { attachmentKindSchema } from "./core-types.schema"
import { assertParity } from "./type-parity"

export const chatAttachmentSchema = z.object({
  id: z.string(),
  kind: attachmentKindSchema,
  displayName: z.string(),
  absolutePath: z.string(),
  relativePath: z.string(),
  contentUrl: z.string(),
  mimeType: z.string(),
  size: z.number(),
})

export const pushSubscribeRequestPayloadSchema = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
})

assertParity<z.output<typeof chatAttachmentSchema>, ChatAttachment>()
assertParity<z.output<typeof pushSubscribeRequestPayloadSchema>, PushSubscribeRequestPayload>()
