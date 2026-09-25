import { create } from "zustand"
import { LOG_PREFIX } from "../../shared/branding"
import { onRejected, toError } from "../../shared/errors"
import { log } from "../../shared/log"

const NO_ACTIONS: Readonly<Record<string, true>> = {}

interface PendingActionsState {
  inFlight: Readonly<Record<string, true>>
  begin(key: string): boolean
  end(key: string): void
}

export const usePendingActionsStore = create<PendingActionsState>()((set, get) => ({
  inFlight: NO_ACTIONS,
  begin: (key) => {
    if (get().inFlight[key]) return false
    set((state) => ({ inFlight: { ...state.inFlight, [key]: true } }))
    return true
  },
  end: (key) => {
    const { inFlight } = get()
    if (!inFlight[key]) return
    const rest = Object.fromEntries(Object.entries(inFlight).filter(([pendingKey]) => pendingKey !== key))
    set({ inFlight: Object.keys(rest).length > 0 ? rest : NO_ACTIONS })
  },
}))

export function pendingActionKey(scope: string, ...ids: readonly string[]): string {
  return [scope, ...ids].join(":")
}

export function runPendingAction<T>(key: string, action: () => Promise<T>): void {
  const store = usePendingActionsStore.getState()
  if (!store.begin(key)) return
  const settle = () => usePendingActionsStore.getState().end(key)
  const fail = (error: Error) => {
    settle()
    log.error(LOG_PREFIX, `action ${key} failed`, error)
  }
  let task: Promise<T>
  try {
    task = action()
  } catch (error) {
    fail(toError(error))
    return
  }
  task.then(settle, onRejected(fail))
}

export function usePendingAction(key: string): boolean {
  return usePendingActionsStore((state) => state.inFlight[key] === true)
}

export function isPendingAction(key: string): boolean {
  return usePendingActionsStore.getState().inFlight[key] === true
}
