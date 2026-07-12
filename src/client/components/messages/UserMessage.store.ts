import { createScopedStore } from "../../lib/createScopedStore"

interface UserMessageState {
  selectedAttachmentId: string | null
  setSelectedAttachmentId: (id: string | null) => void
}

export const UserMessageStore = createScopedStore<void, UserMessageState>(
  "UserMessage",
  () => (set) => ({
    selectedAttachmentId: null,
    setSelectedAttachmentId: (selectedAttachmentId) => set({ selectedAttachmentId }),
  }),
)
