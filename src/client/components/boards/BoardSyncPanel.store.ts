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

/** `owner/repo` for a github-issues binding; null for any other provider. */
export function bindingSlug(binding: BoardSyncStatus["bindings"][number]): string | null {
  return binding.sourceRef.provider === "github-issues"
    ? `${binding.sourceRef.owner}/${binding.sourceRef.repo}`
    : null
}

/**
 * Seed the draft with a repo the board is NOT yet connected to.
 *
 * A board holds N bindings, so the field is an ADD row, not an edit of "the"
 * binding — seeding it from the first existing binding would make Save look
 * like a no-op and, on a Stack board, hide every project still waiting to be
 * connected. Existing bindings are listed and disconnected individually.
 */
function seedFrom(status: BoardSyncStatus): Pick<
  BoardSyncPanelState,
  "repoDraft" | "direction" | "allowAgentPush"
> {
  const bound = new Set(status.bindings.map(bindingSlug).filter((slug): slug is string => slug !== null))
  const nextUnbound = status.suggestedRepos
    .map((suggestion) => (suggestion.repo ? `${suggestion.repo.owner}/${suggestion.repo.repo}` : null))
    .find((slug): slug is string => slug !== null && !bound.has(slug))

  return { repoDraft: nextUnbound ?? "", direction: "pull", allowAgentPush: false }
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
