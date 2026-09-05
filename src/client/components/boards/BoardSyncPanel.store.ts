import { create } from "zustand"
import type { BoardSyncStatus } from "../../../shared/boards/sync-types"
import type { SyncDirection } from "../../../shared/boards/types"

interface BoardSyncPanelState {
  status: BoardSyncStatus | null
  error: string | null
  saving: boolean
  repoDraft: string
  direction: SyncDirection
  allowAgentPush: boolean
  rowDirections: Record<string, SyncDirection>
  savingRow: string | null
  confirmingDetach: string | null
  setStatus(status: BoardSyncStatus): void
  setRepoDraft(repoDraft: string): void
  setDirection(direction: SyncDirection): void
  setAllowAgentPush(allowAgentPush: boolean): void
  setRowDirection(projectId: string, direction: SyncDirection): void
  setSavingRow(projectId: string | null): void
  setConfirmingDetach(projectId: string | null): void
  setError(error: string | null): void
  beginSave(): void
  endSave(): void
  reset(): void
}

export function bindingSlug(binding: BoardSyncStatus["bindings"][number]): string | null {
  return binding.sourceRef.provider === "github-issues"
    ? `${binding.sourceRef.owner}/${binding.sourceRef.repo}`
    : null
}

const SEEDED: Pick<BoardSyncPanelState, "repoDraft" | "direction" | "allowAgentPush" | "rowDirections"> = {
  repoDraft: "",
  direction: "pull",
  allowAgentPush: false,
  rowDirections: {},
}

export const useBoardSyncPanelStore = create<BoardSyncPanelState>()((set) => ({
  status: null,
  error: null,
  saving: false,
  repoDraft: "",
  direction: "pull",
  allowAgentPush: false,
  rowDirections: {},
  savingRow: null,
  confirmingDetach: null,
  setStatus: (status) => set({ status, error: null, savingRow: null, confirmingDetach: null, ...SEEDED }),
  setRepoDraft: (repoDraft) => set({ repoDraft }),
  setDirection: (direction) => set({ direction }),
  setAllowAgentPush: (allowAgentPush) => set({ allowAgentPush }),
  setRowDirection: (projectId, direction) =>
    set((state) => ({ rowDirections: { ...state.rowDirections, [projectId]: direction } })),
  setSavingRow: (savingRow) => set({ savingRow }),
  setConfirmingDetach: (confirmingDetach) => set({ confirmingDetach }),
  setError: (error) => set({ error }),
  beginSave: () => set({ saving: true, error: null }),
  endSave: () => set({ saving: false }),
  reset: () => set({ status: null, error: null, saving: false, savingRow: null, confirmingDetach: null, ...SEEDED }),
}))
