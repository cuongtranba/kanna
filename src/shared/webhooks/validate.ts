import {
  WEBHOOK_MODES,
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

export function isWebhookMode(value: string): value is WebhookMode {
  return WEBHOOK_MODES.some((mode) => mode === value)
}

export function validateWebhookTarget(fields: WebhookTargetFields): string[] {
  const needsChat = fields.mode === "notify" || fields.mode === "inline"
  if (needsChat && !fields.chatId) return ["A chat is required for notify and inline hooks"]
  if (fields.mode === "spawn" && !fields.projectId) return ["A project is required for spawn hooks"]
  return []
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
  return errors
}
