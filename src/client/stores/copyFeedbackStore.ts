import { useCallback, useMemo } from "react"
import { create } from "zustand"
import { clipboardAdapter } from "../adapters/clipboard.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import type { ClipboardPort } from "../ports/clipboardPort"
import type { TimerPort } from "../ports/timerPort"
import { omitKeyOrEmpty } from "../lib/recordOps"

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
    set({ copiedTokens: omitKeyOrEmpty(copiedTokens, key, NO_COPIES) })
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

export interface CopyFeedbackPorts {
  clipboard?: ClipboardPort
  timer?: TimerPort
}

let copyFeedbackSequence = 0

function nextCopyFeedbackKey(): string {
  copyFeedbackSequence += 1
  return `copy:${copyFeedbackSequence}`
}

export function useCopyFeedback(ports: CopyFeedbackPorts = {}): { copied: boolean; copy: (text: string) => Promise<void> } {
  const key = useMemo(nextCopyFeedbackKey, [])
  const copied = useCopied(key)
  const clipboard = ports.clipboard ?? clipboardAdapter
  const timer = ports.timer ?? timerAdapter
  const copy = useCallback(
    (text: string) => copyWithFeedback(key, () => clipboard.writeText(text), timer),
    [clipboard, key, timer],
  )
  return { copied, copy }
}
