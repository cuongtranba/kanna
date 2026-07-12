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
  confirmUnsafeOpen: boolean
  pendingDefaultAction: DefaultAction | null
  setDefaultAction: (action: DefaultAction) => void
  setReadDenyText: (text: string) => void
  setWriteDenyText: (text: string) => void
  setConfirmUnsafeOpen: (open: boolean) => void
  setPendingDefaultAction: (action: DefaultAction | null) => void
}

export const ChatPolicyDialogStore = createScopedStore<ChatPolicyDialogInitProps, ChatPolicyDialogState>(
  "ChatPolicyDialog",
  ({ initialDefaultAction, initialReadDenyText, initialWriteDenyText }) => (set) => ({
    defaultAction: initialDefaultAction,
    readDenyText: initialReadDenyText,
    writeDenyText: initialWriteDenyText,
    confirmUnsafeOpen: false,
    pendingDefaultAction: null,
    setDefaultAction: (defaultAction) => set({ defaultAction }),
    setReadDenyText: (readDenyText) => set({ readDenyText }),
    setWriteDenyText: (writeDenyText) => set({ writeDenyText }),
    setConfirmUnsafeOpen: (confirmUnsafeOpen) => set({ confirmUnsafeOpen }),
    setPendingDefaultAction: (pendingDefaultAction) => set({ pendingDefaultAction }),
  }),
)
