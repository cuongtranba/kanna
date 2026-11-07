import { decodeInboundModelChoice, inboundHandlerTarget, type InboundHandling } from "../../shared/inbound/handler"
import type { ProviderCatalogEntry } from "../../shared/provider-model-types"
import type { WebhookInput, WebhookMode, WebhookPatch } from "../../shared/webhooks/types"
import { validateWebhookInput, validateWebhookModel } from "../../shared/webhooks/validate"

export interface WebhookDraftFields {
  name: string
  mode: WebhookMode
  handling: InboundHandling
  chatId: string
  projectId: string
  modelValue: string
  template: string
  filter: string
  threadKeyPath: string
  senderPath: string
  replyHint: string
}

export function webhookDraftStartsTurn(draft: Pick<WebhookDraftFields, "mode">): boolean {
  return draft.mode !== "notify"
}

export function buildWebhookInput(draft: WebhookDraftFields): WebhookInput {
  const choice = webhookDraftStartsTurn(draft) ? decodeInboundModelChoice(draft.modelValue) : null
  return {
    name: draft.name,
    mode: draft.mode,
    template: draft.template,
    ...inboundHandlerTarget(draft.mode, draft.chatId, draft.projectId),
    ...(choice ? { provider: choice.provider, model: choice.model } : {}),
    ...(webhookDraftStartsTurn(draft) && draft.handling === "task" ? { handling: draft.handling } : {}),
    ...(draft.filter.trim() ? { filter: draft.filter } : {}),
    ...(draft.threadKeyPath.trim() ? { threadKeyPath: draft.threadKeyPath.trim() } : {}),
    ...(draft.senderPath.trim() ? { senderPath: draft.senderPath.trim() } : {}),
    ...(draft.replyHint.trim() ? { replyHint: draft.replyHint } : {}),
  }
}

export function buildWebhookPatch(input: WebhookInput): WebhookPatch {
  return {
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
    handling: input.handling ?? null,
  }
}

export function validateWebhookDraft(
  input: WebhookInput,
  catalog: readonly ProviderCatalogEntry[],
): string[] {
  return [...validateWebhookInput(input), ...validateWebhookModel(input, catalog)]
}
