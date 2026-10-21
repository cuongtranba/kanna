import { z } from "zod"
import type { WebhookSummary, WebhookInput, WebhookPatch } from "./types"
import { agentProviderSchema } from "../core-types.schema"
import { inboundHandlerModeSchema } from "../inbound/handler.schema"
import { assertParity } from "../type-parity"

export const webhookInputSchema = z.object({
  name: z.string(),
  mode: inboundHandlerModeSchema,
  chatId: z.string().optional(),
  projectId: z.string().optional(),
  provider: agentProviderSchema.optional(),
  model: z.string().optional(),
  template: z.string(),
  threadKeyPath: z.string().optional(),
  senderPath: z.string().optional(),
  replyHint: z.string().optional(),
  filter: z.string().optional(),
})

export const webhookPatchSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  mode: inboundHandlerModeSchema.optional(),
  chatId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  provider: agentProviderSchema.nullable().optional(),
  model: z.string().nullable().optional(),
  template: z.string().optional(),
  threadKeyPath: z.string().nullable().optional(),
  senderPath: z.string().nullable().optional(),
  replyHint: z.string().nullable().optional(),
  filter: z.string().nullable().optional(),
})

export const webhookSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  mode: inboundHandlerModeSchema,
  chatId: z.string().optional(),
  projectId: z.string().optional(),
  provider: agentProviderSchema.optional(),
  model: z.string().optional(),
  template: z.string(),
  threadKeyPath: z.string().optional(),
  senderPath: z.string().optional(),
  replyHint: z.string().optional(),
  filter: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  secretHint: z.string(),
  lastDelivery: z.object({
    at: z.number(),
    ok: z.boolean(),
    status: z.number(),
    detail: z.string(),
    filtered: z.boolean().optional(),
  }).optional(),
})

export const createdWebhookSchema = z.object({ hook: webhookSummarySchema, secret: z.string() })
export const updatedWebhookSchema = z.object({ hook: webhookSummarySchema })
export const rotatedWebhookSecretSchema = z.object({ secret: z.string() })
export const deletedWebhookSchema = z.object({ ok: z.boolean() })

assertParity<z.output<typeof webhookSummarySchema>, WebhookSummary>()
assertParity<z.output<typeof webhookInputSchema>, WebhookInput>()
assertParity<z.output<typeof webhookPatchSchema>, WebhookPatch>()
