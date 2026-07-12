import { createScopedStore } from "../../lib/createScopedStore"

interface DiffFileCardState {
  selectedAttachmentId: string | null
  setSelectedAttachmentId: (id: string | null) => void
}

export const DiffFileCardStore = createScopedStore<void, DiffFileCardState>(
  "DiffFileCard",
  () => (set) => ({
    selectedAttachmentId: null,
    setSelectedAttachmentId: (id) => set({ selectedAttachmentId: id }),
  }),
)
