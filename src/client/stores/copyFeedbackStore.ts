import { create } from "zustand"
import { timerAdapter } from "../adapters/timer.adapter"
import type { TimerPort } from "../ports/timerPort"

export const COPIED_FEEDBACK_MS = 2000

const NO_COPIES: Readonly<Record<string, number>> = {}

interface CopyFeedbackState {
  copiedTokens: Readonly<Record<string, number>>
  nextToken: number
  markCopied(key: string): number
  clearCopied(key: string, token: number): void
}

export const useCopyFeedbackStore = create<CopyFeedbackState>()((set, get) => ({
  copiedTokens: NO_COPIES,
  nextToken: 1,
  markCopied: (key) => {
    const token = get().nextToken
    set((state) => ({ nextToken: token + 1, copiedTokens: { ...state.copiedTokens, [key]: token } }))
    return token
  },
  clearCopied: (key, token) => {
    const { copiedTokens } = get()
    if (copiedTokens[key] !== token) return
    const rest = Object.fromEntries(Object.entries(copiedTokens).filter(([copiedKey]) => copiedKey !== key))
    set({ copiedTokens: Object.keys(rest).length > 0 ? rest : NO_COPIES })
  },
}))

export async function copyWithFeedback(
  key: string,
  write: () => Promise<void>,
  timer: TimerPort = timerAdapter,
): Promise<void> {
  await write()
  const token = useCopyFeedbackStore.getState().markCopied(key)
  timer.setTimeout(() => useCopyFeedbackStore.getState().clearCopied(key, token), COPIED_FEEDBACK_MS)
}

export function useCopied(key: string): boolean {
  return useCopyFeedbackStore((state) => state.copiedTokens[key] !== undefined)
}
