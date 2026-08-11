import { create } from "zustand"
import type { BoardSyncStatus } from "../../../shared/boards/sync-types"
import type { SyncDirection } from "../../../shared/boards/types"

/**
 * The sync configuration panel's state.
 *
 * One panel is open at a time — it is anchored to the pane like the card
 * drawer — so a single status slot cannot drift from a keyed map.
 *
 * The repo field is an editable DRAFT rather than a read of the binding,
 * because the panel's whole job is proposing a value the user has not
 * committed yet: the suggestion from `origin` on first open, whatever they
 * typed after that.
 */
interface BoardSyncPanelState {
  status: BoardSyncStatus | null
  error: string | null
  saving: boolean
  /** `owner/repo`, as typed. Parsed only on save. */
  repoDraft: string
  direction: SyncDirection
  allowAgentPush: boolean
  /** Replace the whole panel from a fresh read, seeding the draft. */
  setStatus(status: BoardSyncStatus): void
  setRepoDraft(repoDraft: string): void
  setDirection(direction: SyncDirection): void
  setAllowAgentPush(allowAgentPush: boolean): void
  setError(error: string | null): void
  beginSave(): void
  endSave(): void
  reset(): void
}

/**
 * Seed the editable fields from the binding when there is one, and from the
 * detected remote when there is not. A bound board must never show a repo it
 * is not actually bound to.
 */
function seedFrom(status: BoardSyncStatus): Pick<
  BoardSyncPanelState,
  "repoDraft" | "direction" | "allowAgentPush"
> {
  if (status.binding && status.binding.sourceRef.provider === "github-issues") {
    const { owner, repo } = status.binding.sourceRef
    return {
      repoDraft: `${owner}/${repo}`,
      direction: status.binding.direction,
      allowAgentPush: status.binding.allowAgentPush,
    }
  }
  return {
    repoDraft: status.suggestedRepo ? `${status.suggestedRepo.owner}/${status.suggestedRepo.repo}` : "",
    direction: "pull",
    allowAgentPush: false,
  }
}

export const useBoardSyncPanelStore = create<BoardSyncPanelState>()((set) => ({
  status: null,
  error: null,
  saving: false,
  repoDraft: "",
  direction: "pull",
  allowAgentPush: false,
  setStatus: (status) => set({ status, error: null, ...seedFrom(status) }),
  setRepoDraft: (repoDraft) => set({ repoDraft }),
  setDirection: (direction) => set({ direction }),
  setAllowAgentPush: (allowAgentPush) => set({ allowAgentPush }),
  setError: (error) => set({ error }),
  beginSave: () => set({ saving: true, error: null }),
  endSave: () => set({ saving: false }),
  reset: () =>
    set({
      status: null,
      error: null,
      saving: false,
      repoDraft: "",
      direction: "pull",
      allowAgentPush: false,
    }),
}))
