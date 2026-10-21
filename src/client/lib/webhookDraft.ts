import type { ProviderCatalogEntry } from "../../shared/provider-model-types"
import type { WebhookInput, WebhookKind, WebhookMode, WebhookPatch, WebhookSlackInput } from "../../shared/webhooks/types"
import { validateWebhookInput, validateWebhookModel } from "../../shared/webhooks/validate"
import { decodeWebhookModel } from "./webhookTargets"

export interface WebhookDraftFields {
  name: string
  kind: WebhookKind
  mode: WebhookMode
  chatId: string
  projectId: string
  modelValue: string
  template: string
  filter: string
  threadKeyPath: string
  senderPath: string
  replyHint: string
  signingSecret: string
  botToken: string
  allowedUserIds: string
}

export function parseSlackMemberIds(text: string): string[] {
  const ids = text
    .split(/[\s,;]+/)
    .map((id) => id.trim().toUpperCase())
    .filter((id) => id.length > 0)
  return [...new Set(ids)]
}

export function effectiveWebhookMode(draft: Pick<WebhookDraftFields, "kind" | "mode">): WebhookMode {
  return draft.kind === "slack" ? "spawn" : draft.mode
}

export function webhookDraftStartsTurn(draft: Pick<WebhookDraftFields, "kind" | "mode">): boolean {
  return effectiveWebhookMode(draft) !== "notify"
}

function slackInputOf(draft: WebhookDraftFields): WebhookSlackInput {
  return {
    allowedUserIds: parseSlackMemberIds(draft.allowedUserIds),
    signingSecret: draft.signingSecret.trim(),
    botToken: draft.botToken.trim(),
  }
}

export function buildWebhookInput(draft: WebhookDraftFields): WebhookInput {
  const mode = effectiveWebhookMode(draft)
  const choice = webhookDraftStartsTurn(draft) ? decodeWebhookModel(draft.modelValue) : null
  const base: WebhookInput = {
    name: draft.name,
    mode,
    template: draft.template,
    ...(mode === "spawn" ? { projectId: draft.projectId } : { chatId: draft.chatId }),
    ...(choice ? { provider: choice.provider, model: choice.model } : {}),
  }
  if (draft.kind === "slack") return { ...base, kind: "slack", slack: slackInputOf(draft) }
  return {
    ...base,
    ...(draft.filter.trim() ? { filter: draft.filter } : {}),
    ...(draft.threadKeyPath.trim() ? { threadKeyPath: draft.threadKeyPath.trim() } : {}),
    ...(draft.senderPath.trim() ? { senderPath: draft.senderPath.trim() } : {}),
    ...(draft.replyHint.trim() ? { replyHint: draft.replyHint } : {}),
  }
}

export function buildWebhookPatch(input: WebhookInput): WebhookPatch {
  const patch: WebhookPatch = {
    name: input.name,
    mode: input.mode,
    template: input.template,
    chatId: input.chatId ?? null,
    projectId: input.projectId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    filter: input.filter ?? null,
    threadKeyPath: input.threadKeyPath ?? null,
    senderPath: input.senderPath ?? null,
    replyHint: input.replyHint ?? null,
  }
  if (input.kind !== "slack" || !input.slack) return patch
  const { allowedUserIds, signingSecret, botToken } = input.slack
  return {
    ...patch,
    slack: {
      allowedUserIds,
      ...(signingSecret ? { signingSecret } : {}),
      ...(botToken ? { botToken } : {}),
    },
  }
}

export function validateWebhookDraft(
  input: WebhookInput,
  catalog: readonly ProviderCatalogEntry[],
  editing: boolean,
): string[] {
  return [...validateWebhookInput(input, { requireSlackSecrets: !editing }), ...validateWebhookModel(input, catalog)]
}
