import type { AgentProvider } from "../core-types"
import type { ProviderCatalogEntry } from "../provider-model-types"
import { isInboundHandlerMode, validateInboundTarget } from "../inbound/handler"
import {
  WEBHOOK_MODEL_MAX_CHARS,
  WEBHOOK_PATH_MAX_CHARS,
  WEBHOOK_REPLY_HINT_MAX_CHARS,
  WEBHOOK_NAME_MAX_CHARS,
  WEBHOOK_TEMPLATE_MAX_CHARS,
  type WebhookInput,
  type WebhookMode,
} from "./types"

export interface WebhookTargetFields {
  mode: WebhookMode
  chatId?: string | null
  projectId?: string | null
}

export interface WebhookModelFields {
  provider?: AgentProvider | null
  model?: string | null
}

export function isWebhookMode(value: string): value is WebhookMode {
  return isInboundHandlerMode(value)
}

export function validateWebhookTarget(fields: WebhookTargetFields): string[] {
  return validateInboundTarget(fields)
}

export function validateWebhookInput(input: WebhookInput): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  if (name.length === 0) errors.push("Name is required")
  if (name.length > WEBHOOK_NAME_MAX_CHARS) errors.push(`Name must be at most ${WEBHOOK_NAME_MAX_CHARS} characters`)
  errors.push(...validateWebhookTarget(input))
  const template = input.template.trim()
  if (template.length === 0) errors.push("Template is required")
  if (template.length > WEBHOOK_TEMPLATE_MAX_CHARS) {
    errors.push(`Template must be at most ${WEBHOOK_TEMPLATE_MAX_CHARS} characters`)
  }
  const paths = [input.threadKeyPath, input.senderPath]
  if (paths.some((path) => (path?.length ?? 0) > WEBHOOK_PATH_MAX_CHARS)) {
    errors.push(`Paths must be at most ${WEBHOOK_PATH_MAX_CHARS} characters`)
  }
  if ((input.replyHint?.length ?? 0) > WEBHOOK_REPLY_HINT_MAX_CHARS) {
    errors.push(`Reply hint must be at most ${WEBHOOK_REPLY_HINT_MAX_CHARS} characters`)
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
