import { createScopedStore } from "../lib/createScopedStore"
import type { WebhookMode } from "../../shared/webhooks/types"

export const DEFAULT_WEBHOOK_TEMPLATE = "A webhook was received. Summarize what happened and say whether it needs attention."

export interface WebhookCreateDraft {
  name: string
  mode: WebhookMode
  chatId: string
  projectId: string
  template: string
  setName: (name: string) => void
  setMode: (mode: WebhookMode) => void
  setChatId: (chatId: string) => void
  setProjectId: (projectId: string) => void
  setTemplate: (template: string) => void
}

export const WebhookCreateStore = createScopedStore<void, WebhookCreateDraft>(
  "WebhookCreateDialog",
  () => (set) => ({
    name: "",
    mode: "notify",
    chatId: "",
    projectId: "",
    template: DEFAULT_WEBHOOK_TEMPLATE,
    setName: (name) => set({ name }),
    setMode: (mode) => set({ mode }),
    setChatId: (chatId) => set({ chatId }),
    setProjectId: (projectId) => set({ projectId }),
    setTemplate: (template) => set({ template }),
  }),
)
