import { createScopedStore } from "../../lib/createScopedStore"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"

type DefaultAction = ChatPermissionPolicy["defaultAction"]

interface ChatPolicyDialogInitProps {
  initialDefaultAction: DefaultAction
  initialReadDenyText: string
  initialWriteDenyText: string
}

interface ChatPolicyDialogState {
  defaultAction: DefaultAction
  readDenyText: string
  writeDenyText: string
  pendingDefaultAction: DefaultAction | null
  requestDefaultAction: (action: DefaultAction) => void
  confirmPendingDefaultAction: () => void
  cancelPendingDefaultAction: () => void
  setReadDenyText: (text: string) => void
  setWriteDenyText: (text: string) => void
}

export const ChatPolicyDialogStore = createScopedStore<ChatPolicyDialogInitProps, ChatPolicyDialogState>(
  "ChatPolicyDialog",
  ({ initialDefaultAction, initialReadDenyText, initialWriteDenyText }) => (set) => ({
    defaultAction: initialDefaultAction,
    readDenyText: initialReadDenyText,
    writeDenyText: initialWriteDenyText,
    pendingDefaultAction: null,
    requestDefaultAction: (action) =>
      set((state) =>
        action === "auto-allow" && state.defaultAction !== "auto-allow"
          ? { pendingDefaultAction: action }
          : { defaultAction: action },
      ),
    confirmPendingDefaultAction: () =>
      set((state) =>
        state.pendingDefaultAction === null
          ? state
          : { defaultAction: state.pendingDefaultAction, pendingDefaultAction: null },
      ),
    cancelPendingDefaultAction: () => set({ pendingDefaultAction: null }),
    setReadDenyText: (readDenyText) => set({ readDenyText }),
    setWriteDenyText: (writeDenyText) => set({ writeDenyText }),
  }),
)
