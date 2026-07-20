import { create } from "zustand"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"

/**
 * Singleton store for ChatPage and its child components (ChatTranscriptViewport,
 * useChatPageSidebarActions). All state here belongs to the single ChatPage
 * instance that is active at any given time.
 *
 * None of this state is persisted — all values are ephemeral UI / DOM-measurement
 * state that should reset on page reload.
 */

// ─── Empty-state typing ───────────────────────────────────────────────────────

interface EmptyStateTypingSlice {
  typedEmptyStateText: string
  isEmptyStateTypingComplete: boolean
  setTypedEmptyStateText: (text: string) => void
  setIsEmptyStateTypingComplete: (complete: boolean) => void
  resetEmptyStateTyping: () => void
}

// ─── Page file drag ───────────────────────────────────────────────────────────

interface PageFileDragSlice {
  isPageFileDragActive: boolean
  setIsPageFileDragActive: (active: boolean) => void
}

// ─── Layout width ─────────────────────────────────────────────────────────────

interface LayoutWidthSlice {
  layoutWidth: number
  setLayoutWidth: (width: number) => void
}

// ─── Transcript padding bottom ────────────────────────────────────────────────

interface TranscriptPaddingSlice {
  inputHeight: number
  setInputHeight: (height: number) => void
}

// ─── Mobile right sidebar overlay ────────────────────────────────────────────

interface MobileRightSidebarSlice {
  viewportWidth: number
  setViewportWidth: (width: number) => void
}

// ─── Fixed terminal height ────────────────────────────────────────────────────

interface FixedTerminalHeightSlice {
  fixedTerminalHeight: number
  setFixedTerminalHeight: (height: number) => void
}

// ─── Scroll to bottom ────────────────────────────────────────────────────────

interface ScrollToBottomSlice {
  showScrollToBottom: boolean
  setShowScrollToBottom: (show: boolean) => void
}

// ─── Tool group expanded (ChatTranscriptViewport) ────────────────────────────

interface ToolGroupExpandedSlice {
  toolGroupExpanded: Record<string, boolean>
  setToolGroupExpanded: (
    updater: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void
  resetToolGroupExpanded: () => void
}

// ─── Local link menu target (ChatTranscriptViewport) ─────────────────────────

import type { OpenLocalLinkTarget } from "../components/messages/shared"

interface LocalLinkMenuSlice {
  localLinkMenuTarget: OpenLocalLinkTarget | null
  setLocalLinkMenuTarget: (target: OpenLocalLinkTarget | null) => void
}

// ─── Diff render mode / wrap lines (useChatPageSidebarActions) ───────────────

interface DiffViewSlice {
  diffRenderMode: "unified" | "split"
  wrapDiffLines: boolean
  setDiffRenderMode: (mode: "unified" | "split") => void
  setWrapDiffLines: (wrap: boolean) => void
}

// ─── Terminal focus request version (useTerminalToggleAnimation) ──────────────

interface TerminalFocusSlice {
  terminalFocusRequestVersion: number
  incrementTerminalFocusRequestVersion: () => void
}

// ─── Combined store ───────────────────────────────────────────────────────────

type ChatPageState =
  & EmptyStateTypingSlice
  & PageFileDragSlice
  & LayoutWidthSlice
  & TranscriptPaddingSlice
  & MobileRightSidebarSlice
  & FixedTerminalHeightSlice
  & ScrollToBottomSlice
  & ToolGroupExpandedSlice
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
  // Empty-state typing
  typedEmptyStateText: "",
  isEmptyStateTypingComplete: false,
  setTypedEmptyStateText: (text) => set({ typedEmptyStateText: text }),
  setIsEmptyStateTypingComplete: (complete) => set({ isEmptyStateTypingComplete: complete }),
  resetEmptyStateTyping: () => set({ typedEmptyStateText: "", isEmptyStateTypingComplete: false }),

  // Page file drag
  isPageFileDragActive: false,
  setIsPageFileDragActive: (active) => set({ isPageFileDragActive: active }),

  // Layout width
  layoutWidth: 0,
  setLayoutWidth: (width) => set({ layoutWidth: width }),

  // Transcript padding (input height)
  inputHeight: 148,
  setInputHeight: (height) => set({ inputHeight: height }),

  // Mobile right sidebar overlay
  viewportWidth: getInitialViewportWidth(),
  setViewportWidth: (width) => set({ viewportWidth: width }),

  // Fixed terminal height
  fixedTerminalHeight: 0,
  setFixedTerminalHeight: (height) => set({ fixedTerminalHeight: height }),

  // Scroll to bottom
  showScrollToBottom: false,
  setShowScrollToBottom: (show) => set({ showScrollToBottom: show }),

  // Tool group expanded
  toolGroupExpanded: {},
  setToolGroupExpanded: (updater) =>
    set((state) => ({ toolGroupExpanded: updater(state.toolGroupExpanded) })),
  resetToolGroupExpanded: () => set({ toolGroupExpanded: {} }),

  // Local link menu target
  localLinkMenuTarget: null,
  setLocalLinkMenuTarget: (target) => set({ localLinkMenuTarget: target }),

  // Diff view
  diffRenderMode: "unified",
  wrapDiffLines: false,
  setDiffRenderMode: (mode) => set({ diffRenderMode: mode }),
  setWrapDiffLines: (wrap) => set({ wrapDiffLines: wrap }),

  // Terminal focus request version
  terminalFocusRequestVersion: 0,
  incrementTerminalFocusRequestVersion: () =>
    set((state) => ({ terminalFocusRequestVersion: state.terminalFocusRequestVersion + 1 })),
}))
