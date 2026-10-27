import { create } from "zustand"
import type { WebhookSummary } from "../../shared/webhooks/types"

const EMPTY: readonly WebhookSummary[] = []

export type WebhookEditor = { mode: "create" } | { mode: "edit"; hookId: string }

export interface WebhookSecretReveal {
  hookId: string
  hookName: string
  secret: string
}

interface WebhooksState {
  hooks: readonly WebhookSummary[]
  secretReveal: WebhookSecretReveal | null
  editor: WebhookEditor | null
  setHooks(hooks: readonly WebhookSummary[]): void
  revealSecret(reveal: WebhookSecretReveal): void
  dismissSecret(): void
  openCreate(): void
  openEdit(hookId: string): void
  closeEditor(): void
}

export const useWebhooksStore = create<WebhooksState>()((set) => ({
  hooks: EMPTY,
  secretReveal: null,
  editor: null,
  setHooks: (hooks) => set({ hooks: hooks.length > 0 ? hooks : EMPTY }),
  revealSecret: (secretReveal) => set({ secretReveal }),
  dismissSecret: () => set({ secretReveal: null }),
  openCreate: () => set({ editor: { mode: "create" } }),
  openEdit: (hookId) => set({ editor: { mode: "edit", hookId } }),
  closeEditor: () => set({ editor: null }),
}))
