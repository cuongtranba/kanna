import type { AgentProvider } from "../core-types"
import type { ProviderCatalogEntry } from "../provider-model-types"
import {
  inboundNameErrors,
  inboundPathErrors,
  inboundReplyHintErrors,
  inboundTemplateErrors,
  validateInboundTarget,
} from "../inbound/handler"
import { WEBHOOK_FILTER_MAX_CHARS, WEBHOOK_MODEL_MAX_CHARS, type WebhookInput } from "./types"

export interface WebhookModelFields {
  provider?: AgentProvider | null
  model?: string | null
}

export function validateWebhookInput(input: WebhookInput): string[] {
  const errors: string[] = []
  errors.push(...inboundNameErrors(input.name))
  errors.push(...validateInboundTarget(input))
  errors.push(...inboundTemplateErrors(input.template))
  errors.push(...inboundPathErrors([input.threadKeyPath, input.senderPath]))
  errors.push(...inboundReplyHintErrors(input.replyHint))
  if ((input.filter?.length ?? 0) > WEBHOOK_FILTER_MAX_CHARS) {
    errors.push(`Filter must be at most ${WEBHOOK_FILTER_MAX_CHARS} characters`)
  }
  return errors
}

export function mergeWebhookModel(existing: WebhookModelFields, patch: WebhookModelFields): WebhookModelFields {
  if (patch.provider === null || patch.model === null) return {}
  return {
    provider: patch.provider ?? existing.provider,
    model: patch.model ?? existing.model,
  }
}

export function validateWebhookModel(
  fields: WebhookModelFields,
  catalog: readonly ProviderCatalogEntry[],
): string[] {
  const provider = fields.provider ?? undefined
  const model = fields.model?.trim() || undefined
  if (provider === undefined && model === undefined) return []
  if (provider === undefined || model === undefined) return ["Provider and model must be set together"]
  const entry = catalog.find((candidate) => candidate.id === provider)
  if (!entry) return [`Provider ${provider} is not available`]
  if (provider === "openrouter") {
    return model.length > WEBHOOK_MODEL_MAX_CHARS
      ? [`Model must be at most ${WEBHOOK_MODEL_MAX_CHARS} characters`]
      : []
  }
  if (!entry.models.some((option) => option.id === model)) return [`Model ${model} is not available for ${provider}`]
  return []
}
