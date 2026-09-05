import { createScopedStore } from "../lib/createScopedStore"
import type { ChatAttachment } from "../../shared/types"


export interface ComposerAttachment extends ChatAttachment {
  status: "uploading" | "uploaded" | "failed"
  previewUrl?: string
  uploadProgress?: number
  cancelUpload?: () => void
}

export interface MentionSuggestionsState {
  items: { path: string; kind: "file" | "dir" }[]
  loading: boolean
  error: string | null
}


const EMPTY_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_MENTION_ITEMS: { path: string; kind: "file" | "dir" }[] = []
const EMPTY_TOOL_GROUP_EXPANDED: Record<string, boolean> = {}


export interface ChatTabScopedState {
  toolGroupExpanded: Record<string, boolean>
  setToolGroupExpanded: (
    updater: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void
  resetToolGroupExpanded: () => void

  inputHeight: number
  setInputHeight: (height: number) => void

  showScrollToBottom: boolean
  setShowScrollToBottom: (show: boolean) => void

  attachments: ComposerAttachment[]
  setAttachments: (
    updater: ComposerAttachment[] | ((current: ComposerAttachment[]) => ComposerAttachment[]),
  ) => void

  selectedAttachmentId: string | null
  setSelectedAttachmentId: (id: string | null) => void

  uploadError: string | null
  setUploadError: (error: string | null) => void

  currentText: string
  setCurrentText: (text: string) => void

  mentionQuery: string | null
  setMentionQuery: (query: string | null) => void

  slashQuery: string | null
  setSlashQuery: (query: string | null) => void

  mentionSuggestions: MentionSuggestionsState
  setMentionSuggestions: (state: MentionSuggestionsState) => void

  sharePopoverOpen: boolean
  setSharePopoverOpen: (open: boolean) => void
  chatSettingsOpen: boolean
  setChatSettingsOpen: (open: boolean) => void
}


export const ChatTabScopedStore = createScopedStore<void, ChatTabScopedState>(
  "ChatTabScoped",
  () => (set) => ({
    toolGroupExpanded: EMPTY_TOOL_GROUP_EXPANDED,
    setToolGroupExpanded: (updater) =>
      set((state) => ({ toolGroupExpanded: updater(state.toolGroupExpanded) })),
    resetToolGroupExpanded: () => set({ toolGroupExpanded: EMPTY_TOOL_GROUP_EXPANDED }),

    inputHeight: 148,
    setInputHeight: (height) => set({ inputHeight: height }),

    showScrollToBottom: false,
    setShowScrollToBottom: (show) => set({ showScrollToBottom: show }),

    attachments: EMPTY_ATTACHMENTS,
    setAttachments: (updater) =>
      set((state) => ({
        attachments: typeof updater === "function" ? updater(state.attachments) : updater,
      })),

    selectedAttachmentId: null,
    setSelectedAttachmentId: (id) => set({ selectedAttachmentId: id }),

    uploadError: null,
    setUploadError: (error) => set({ uploadError: error }),

    currentText: "",
    setCurrentText: (text) => set({ currentText: text }),

    mentionQuery: null,
    setMentionQuery: (query) => set({ mentionQuery: query }),

    slashQuery: null,
    setSlashQuery: (query) => set({ slashQuery: query }),

    mentionSuggestions: { items: EMPTY_MENTION_ITEMS, loading: false, error: null },
    setMentionSuggestions: (suggState) => set({ mentionSuggestions: suggState }),

    sharePopoverOpen: false,
    setSharePopoverOpen: (open) => set({ sharePopoverOpen: open }),
    chatSettingsOpen: false,
    setChatSettingsOpen: (open) => set({ chatSettingsOpen: open }),
  }),
)
