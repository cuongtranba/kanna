import { createScopedStore } from "../lib/createScopedStore"
import type { WebhookDraftFields } from "../lib/webhookDraft"
import { encodeInboundModelChoice } from "../../shared/inbound/handler"
import type { WebhookSummary } from "../../shared/webhooks/types"

export const DEFAULT_WEBHOOK_TEMPLATE = "A webhook was received. Summarize what happened and say whether it needs attention."

export interface WebhookCreateDraft {
  draft: WebhookDraftFields
  patchDraft: (patch: Partial<WebhookDraftFields>) => void
}

export const WebhookCreateStore = createScopedStore<WebhookSummary | undefined, WebhookCreateDraft>(
  "WebhookCreateDialog",
  (hook) => (set) => ({
    draft: {
      name: hook?.name ?? "",
      mode: hook?.mode ?? "notify",
      handling: hook?.handling ?? "triage",
      chatId: hook?.chatId ?? "",
      projectId: hook?.projectId ?? "",
      modelValue: hook?.provider && hook.model ? encodeInboundModelChoice(hook.provider, hook.model) : "",
      template: hook?.template ?? DEFAULT_WEBHOOK_TEMPLATE,
      filter: hook?.filter ?? "",
      threadKeyPath: hook?.threadKeyPath ?? "",
      senderPath: hook?.senderPath ?? "",
      replyHint: hook?.replyHint ?? "",
    },
    patchDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  }),
)
