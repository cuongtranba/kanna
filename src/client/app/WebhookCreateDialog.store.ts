import { createScopedStore } from "../lib/createScopedStore"
import type { WebhookDraftFields } from "../lib/webhookDraft"
import { encodeWebhookModel } from "../lib/webhookTargets"
import type { InboundHandling } from "../../shared/inbound/handler"
import type { WebhookKind, WebhookMode, WebhookSummary } from "../../shared/webhooks/types"

export const DEFAULT_WEBHOOK_TEMPLATE = "A webhook was received. Summarize what happened and say whether it needs attention."

export interface WebhookCreateDraft extends WebhookDraftFields {
  slackSetupOpen: boolean
  setName: (name: string) => void
  setKind: (kind: WebhookKind) => void
  setMode: (mode: WebhookMode) => void
  setHandling: (handling: InboundHandling) => void
  setChatId: (chatId: string) => void
  setProjectId: (projectId: string) => void
  setModelValue: (modelValue: string) => void
  setTemplate: (template: string) => void
  setFilter: (filter: string) => void
  setThreadKeyPath: (threadKeyPath: string) => void
  setSenderPath: (senderPath: string) => void
  setReplyHint: (replyHint: string) => void
  setSigningSecret: (signingSecret: string) => void
  setBotToken: (botToken: string) => void
  setAllowedUserIds: (allowedUserIds: string) => void
  toggleSlackSetup: () => void
}

export function selectWebhookDraftFields(state: WebhookCreateDraft): WebhookDraftFields {
  return {
    name: state.name,
    kind: state.kind,
    mode: state.mode,
    handling: state.handling,
    chatId: state.chatId,
    projectId: state.projectId,
    modelValue: state.modelValue,
    template: state.template,
    filter: state.filter,
    threadKeyPath: state.threadKeyPath,
    senderPath: state.senderPath,
    replyHint: state.replyHint,
    signingSecret: state.signingSecret,
    botToken: state.botToken,
    allowedUserIds: state.allowedUserIds,
  }
}

function templateAfterKindChange(kind: WebhookKind, template: string): string {
  if (kind === "slack" && template === DEFAULT_WEBHOOK_TEMPLATE) return ""
  if (kind === "generic" && template === "") return DEFAULT_WEBHOOK_TEMPLATE
  return template
}

export const WebhookCreateStore = createScopedStore<WebhookSummary | undefined, WebhookCreateDraft>(
  "WebhookCreateDialog",
  (hook) => (set) => ({
    name: hook?.name ?? "",
    kind: hook?.kind ?? "generic",
    mode: hook?.mode ?? "notify",
    handling: hook?.handling ?? "triage",
    chatId: hook?.chatId ?? "",
    projectId: hook?.projectId ?? "",
    modelValue: hook?.provider && hook.model ? encodeWebhookModel(hook.provider, hook.model) : "",
    template: hook?.template ?? DEFAULT_WEBHOOK_TEMPLATE,
    filter: hook?.filter ?? "",
    threadKeyPath: hook?.threadKeyPath ?? "",
    senderPath: hook?.senderPath ?? "",
    replyHint: hook?.replyHint ?? "",
    signingSecret: "",
    botToken: "",
    allowedUserIds: hook?.slack?.allowedUserIds.join(", ") ?? "",
    slackSetupOpen: hook === undefined,
    setName: (name) => set({ name }),
    setKind: (kind) => set((state) => ({ kind, template: templateAfterKindChange(kind, state.template) })),
    setMode: (mode) => set({ mode }),
    setHandling: (handling) => set({ handling }),
    setChatId: (chatId) => set({ chatId }),
    setProjectId: (projectId) => set({ projectId }),
    setModelValue: (modelValue) => set({ modelValue }),
    setTemplate: (template) => set({ template }),
    setFilter: (filter) => set({ filter }),
    setThreadKeyPath: (threadKeyPath) => set({ threadKeyPath }),
    setSenderPath: (senderPath) => set({ senderPath }),
    setReplyHint: (replyHint) => set({ replyHint }),
    setSigningSecret: (signingSecret) => set({ signingSecret }),
    setBotToken: (botToken) => set({ botToken }),
    setAllowedUserIds: (allowedUserIds) => set({ allowedUserIds }),
    toggleSlackSetup: () => set((state) => ({ slackSetupOpen: !state.slackSetupOpen })),
  }),
)
