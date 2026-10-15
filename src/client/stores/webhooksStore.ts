import { create } from "zustand"
import type { WebhookSummary } from "../../shared/webhooks/types"

const EMPTY: readonly WebhookSummary[] = []

export interface WebhookSecretReveal {
  hookId: string
  hookName: string
  secret: string
}

interface WebhooksState {
  hooks: readonly WebhookSummary[]
  secretReveal: WebhookSecretReveal | null
  createOpen: boolean
  copiedId: string | null
  setHooks(hooks: readonly WebhookSummary[]): void
  revealSecret(reveal: WebhookSecretReveal): void
  dismissSecret(): void
  setCreateOpen(open: boolean): void
  markCopied(copyId: string): void
}

export const useWebhooksStore = create<WebhooksState>()((set) => ({
  hooks: EMPTY,
  secretReveal: null,
  createOpen: false,
  copiedId: null,
  setHooks: (hooks) => set({ hooks: hooks.length > 0 ? hooks : EMPTY }),
  revealSecret: (secretReveal) => set({ secretReveal }),
  dismissSecret: () => set({ secretReveal: null }),
  setCreateOpen: (createOpen) => set({ createOpen }),
  markCopied: (copiedId) => set({ copiedId }),
}))
