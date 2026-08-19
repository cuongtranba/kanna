import { create } from "zustand"
import type { BoardSyncStatus } from "../../../shared/boards/sync-types"
import type { SyncDirection } from "../../../shared/boards/types"

/**
 * The sync configuration panel's state.
 *
 * One panel is open at a time — it is anchored to the pane like the card
 * drawer — so a single status slot cannot drift from a keyed map.
 *
 * `direction` and `allowAgentPush` are the board's sync POLICY: they apply to
 * every repo connected from this panel, by a suggestion row or by the typed
 * field. `rowDirections` holds only explicit per-row overrides, so a row with
 * no entry follows the policy as it changes rather than freezing a copy of it.
 *
 * The repo field is a DRAFT for a repo the suggestions do not offer. It is
 * never seeded from a suggestion — the rows already offer those, and a
 * prefilled field naming a repo listed above it is one affordance too many.
 */
interface BoardSyncPanelState {
  status: BoardSyncStatus | null
  error: string | null
  saving: boolean
  /** `owner/repo`, as typed. Parsed only on save. */
  repoDraft: string
  direction: SyncDirection
  allowAgentPush: boolean
  /** Per-projectId direction overrides. Absent = follow `direction`. */
  rowDirections: Record<string, SyncDirection>
  /** Which suggestion row (by projectId) is currently saving. */
  savingRow: string | null
  /**
   * Which suggestion row is showing the two-step detach confirmation.
   * Set on first "Move here" click; cleared on confirm or cancel.
   */
  confirmingDetach: string | null
  /** Replace the whole panel from a fresh read, seeding the draft. */
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

/** `owner/repo` for a github-issues binding; null for any other provider. */
export function bindingSlug(binding: BoardSyncStatus["bindings"][number]): string | null {
  return binding.sourceRef.provider === "github-issues"
    ? `${binding.sourceRef.owner}/${binding.sourceRef.repo}`
    : null
}

/** A fresh read resets the policy and every override to the defaults. */
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
