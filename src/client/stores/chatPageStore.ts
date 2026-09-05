import { create } from "zustand"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"



interface EmptyStateTypingSlice {
  typedEmptyStateText: string
  isEmptyStateTypingComplete: boolean
  setTypedEmptyStateText: (text: string) => void
  setIsEmptyStateTypingComplete: (complete: boolean) => void
  resetEmptyStateTyping: () => void
}


interface PageFileDragSlice {
  isPageFileDragActive: boolean
  setIsPageFileDragActive: (active: boolean) => void
}


interface LayoutWidthSlice {
  layoutWidth: number
  setLayoutWidth: (width: number) => void
}


interface MobileRightSidebarSlice {
  viewportWidth: number
  setViewportWidth: (width: number) => void
}


import type { OpenLocalLinkTarget } from "../components/messages/shared"

interface LocalLinkMenuSlice {
  localLinkMenuTarget: OpenLocalLinkTarget | null
  setLocalLinkMenuTarget: (target: OpenLocalLinkTarget | null) => void
  setLocalLinkMenuOpen: (open: boolean) => void
}


interface DiffViewSlice {
  diffRenderMode: "unified" | "split"
  wrapDiffLines: boolean
  setDiffRenderMode: (mode: "unified" | "split") => void
  setWrapDiffLines: (wrap: boolean) => void
}


interface TerminalFocusSlice {
  terminalFocusRequestVersion: number
  incrementTerminalFocusRequestVersion: () => void
}


type ChatPageState =
  & EmptyStateTypingSlice
  & PageFileDragSlice
  & LayoutWidthSlice
  & MobileRightSidebarSlice
  & LocalLinkMenuSlice
  & DiffViewSlice
  & TerminalFocusSlice

export interface ChatPageStorePorts {
  dom?: DomPort
}

function getInitialViewportWidth(ports: ChatPageStorePorts = {}): number {
  return (ports.dom ?? domAdapter).getInnerWidth()
}

export const useChatPageStore = create<ChatPageState>()((set) => ({
  typedEmptyStateText: "",
  isEmptyStateTypingComplete: false,
  setTypedEmptyStateText: (text) => set({ typedEmptyStateText: text }),
  setIsEmptyStateTypingComplete: (complete) => set({ isEmptyStateTypingComplete: complete }),
  resetEmptyStateTyping: () => set({ typedEmptyStateText: "", isEmptyStateTypingComplete: false }),

  isPageFileDragActive: false,
  setIsPageFileDragActive: (active) => set({ isPageFileDragActive: active }),

  layoutWidth: 0,
  setLayoutWidth: (width) => set({ layoutWidth: width }),

  viewportWidth: getInitialViewportWidth(),
  setViewportWidth: (width) => set({ viewportWidth: width }),

  localLinkMenuTarget: null,
  setLocalLinkMenuTarget: (target) => set({ localLinkMenuTarget: target }),
  setLocalLinkMenuOpen: (open) =>
    set((state) => (open || state.localLinkMenuTarget === null ? state : { localLinkMenuTarget: null })),

  diffRenderMode: "unified",
  wrapDiffLines: false,
  setDiffRenderMode: (mode) => set({ diffRenderMode: mode }),
  setWrapDiffLines: (wrap) => set({ wrapDiffLines: wrap }),

  terminalFocusRequestVersion: 0,
  incrementTerminalFocusRequestVersion: () =>
    set((state) => ({ terminalFocusRequestVersion: state.terminalFocusRequestVersion + 1 })),
}))
