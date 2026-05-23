import { create, type StoreApi, type UseBoundStore } from "zustand"
import type { PtyInstanceState } from "../../shared/pty-instance"

const EMPTY: readonly PtyInstanceState[] = Object.freeze([])

export type PtyInstanceDiffOp =
  | { op: "added"; instance: PtyInstanceState }
  | { op: "updated"; instance: PtyInstanceState }
  | { op: "removed"; chatId: string }

interface PtyInstancesState {
  instances: readonly PtyInstanceState[]
  popoverOpen: boolean
  applySnapshot: (instances: PtyInstanceState[]) => void
  applyDiff: (diff: PtyInstanceDiffOp) => void
  openPopover: () => void
  closePopover: () => void
  togglePopover: () => void
}

function liveCount(instances: readonly PtyInstanceState[]): number {
  let count = 0
  for (const instance of instances) {
    if (instance.phase !== "exited") count++
  }
  return count
}

export type PtyInstancesStore = UseBoundStore<StoreApi<PtyInstancesState>>

export function createPtyInstancesStore(): PtyInstancesStore {
  return create<PtyInstancesState>()((set) => ({
    instances: EMPTY,
    popoverOpen: false,

    applySnapshot: (instances) => set({ instances: instances.length === 0 ? EMPTY : instances }),

    applyDiff: (diff) =>
      set((state) => {
        const prev = state.instances
        if (diff.op === "added") {
          if (prev.some((i) => i.chatId === diff.instance.chatId)) return state
          return { instances: [...prev, diff.instance] }
        }
        if (diff.op === "updated") {
          const next = prev.map((i) => (i.chatId === diff.instance.chatId ? diff.instance : i))
          return { instances: next }
        }
        const filtered = prev.filter((i) => i.chatId !== diff.chatId)
        return { instances: filtered.length === 0 ? EMPTY : filtered }
      }),

    openPopover: () => set({ popoverOpen: true }),
    closePopover: () => set({ popoverOpen: false }),
    togglePopover: () => set((state) => ({ popoverOpen: !state.popoverOpen })),
  }))
}

export const usePtyInstancesStore = createPtyInstancesStore()

export function usePtyInstances(): readonly PtyInstanceState[] {
  return usePtyInstancesStore((state) => state.instances)
}

export function usePtyLiveCount(): number {
  return usePtyInstancesStore((state) => liveCount(state.instances))
}

export function usePtyPopoverOpen(): boolean {
  return usePtyInstancesStore((state) => state.popoverOpen)
}
