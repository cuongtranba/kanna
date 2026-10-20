import { createScopedStore } from "../lib/createScopedStore"
import { encodeWebhookModel } from "../lib/webhookTargets"
import type { WebhookMode, WebhookSummary } from "../../shared/webhooks/types"

export const DEFAULT_WEBHOOK_TEMPLATE = "A webhook was received. Summarize what happened and say whether it needs attention."

export interface WebhookCreateDraft {
  name: string
  mode: WebhookMode
  chatId: string
  projectId: string
  modelValue: string
  template: string
  filter: string
  threadKeyPath: string
  senderPath: string
  replyHint: string
  setName: (name: string) => void
  setMode: (mode: WebhookMode) => void
  setChatId: (chatId: string) => void
  setProjectId: (projectId: string) => void
  setModelValue: (modelValue: string) => void
  setTemplate: (template: string) => void
  setFilter: (filter: string) => void
  setThreadKeyPath: (threadKeyPath: string) => void
  setSenderPath: (senderPath: string) => void
  setReplyHint: (replyHint: string) => void
}

export const WebhookCreateStore = createScopedStore<WebhookSummary | undefined, WebhookCreateDraft>(
  "WebhookCreateDialog",
  (hook) => (set) => ({
    name: hook?.name ?? "",
    mode: hook?.mode ?? "notify",
    chatId: hook?.chatId ?? "",
    projectId: hook?.projectId ?? "",
    modelValue: hook?.provider && hook.model ? encodeWebhookModel(hook.provider, hook.model) : "",
    template: hook?.template ?? DEFAULT_WEBHOOK_TEMPLATE,
    filter: hook?.filter ?? "",
    threadKeyPath: hook?.threadKeyPath ?? "",
    senderPath: hook?.senderPath ?? "",
    replyHint: hook?.replyHint ?? "",
    setName: (name) => set({ name }),
    setMode: (mode) => set({ mode }),
    setChatId: (chatId) => set({ chatId }),
    setProjectId: (projectId) => set({ projectId }),
    setModelValue: (modelValue) => set({ modelValue }),
    setTemplate: (template) => set({ template }),
    setFilter: (filter) => set({ filter }),
    setThreadKeyPath: (threadKeyPath) => set({ threadKeyPath }),
    setSenderPath: (senderPath) => set({ senderPath }),
    setReplyHint: (replyHint) => set({ replyHint }),
  }),
)
