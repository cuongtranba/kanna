import { createScopedStore } from "../../lib/createScopedStore"

interface AutoContinueCardState {
  draft: string
  editing: boolean
  setDraft: (draft: string) => void
  setEditing: (editing: boolean) => void
}

export const AutoContinueCardStore = createScopedStore<{ initialDraft: string }, AutoContinueCardState>(
  "AutoContinueCard",
  ({ initialDraft }) => (set) => ({
    draft: initialDraft,
    editing: false,
    setDraft: (draft) => set({ draft }),
    setEditing: (editing) => set({ editing }),
  }),
)
