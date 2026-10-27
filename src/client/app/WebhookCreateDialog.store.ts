import { createScopedStore } from "../lib/createScopedStore"
import type { WebhookDraftFields } from "../lib/webhookDraft"
import { encodeInboundModelChoice } from "../../shared/inbound/handler"
import type { WebhookKind, WebhookSummary } from "../../shared/webhooks/types"

export const DEFAULT_WEBHOOK_TEMPLATE = "A webhook was received. Summarize what happened and say whether it needs attention."

export interface WebhookCreateDraft {
  draft: WebhookDraftFields
  slackSetupOpen: boolean
  setKind: (kind: WebhookKind) => void
  patchDraft: (patch: Partial<WebhookDraftFields>) => void
  toggleSlackSetup: () => void
}

function templateAfterKindChange(kind: WebhookKind, template: string): string {
  if (kind === "slack" && template === DEFAULT_WEBHOOK_TEMPLATE) return ""
  if (kind === "generic" && template === "") return DEFAULT_WEBHOOK_TEMPLATE
  return template
}

export const WebhookCreateStore = createScopedStore<WebhookSummary | undefined, WebhookCreateDraft>(
  "WebhookCreateDialog",
  (hook) => (set) => ({
    draft: {
      name: hook?.name ?? "",
      kind: hook?.kind ?? "generic",
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
      signingSecret: "",
      botToken: "",
      allowedUserIds: hook?.slack?.allowedUserIds.join(", ") ?? "",
    },
    slackSetupOpen: hook === undefined,
    setKind: (kind) =>
      set((state) => ({ draft: { ...state.draft, kind, template: templateAfterKindChange(kind, state.draft.template) } })),
    patchDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
    toggleSlackSetup: () => set((state) => ({ slackSetupOpen: !state.slackSetupOpen })),
  }),
)
