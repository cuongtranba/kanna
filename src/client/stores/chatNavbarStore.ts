import { create } from "zustand"

interface ChatNavbarState {
  sharePopoverOpen: boolean
  setSharePopoverOpen: (open: boolean) => void
}

export const useChatNavbarStore = create<ChatNavbarState>()((set) => ({
  sharePopoverOpen: false,
  setSharePopoverOpen: (open) => set({ sharePopoverOpen: open }),
}))

export const useSharePopoverOpen = () => useChatNavbarStore((state) => state.sharePopoverOpen)
export const useSetSharePopoverOpen = () => useChatNavbarStore((state) => state.setSharePopoverOpen)
