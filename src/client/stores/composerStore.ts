import { create } from "zustand"
import type { ChatAttachment } from "../../shared/types"

// ---------------------------------------------------------------------------
// ComposerAttachment (mirrors the type in ChatInput.tsx)
// ---------------------------------------------------------------------------

export interface ComposerAttachment extends ChatAttachment {
  status: "uploading" | "uploaded" | "failed"
  previewUrl?: string
  uploadProgress?: number
  cancelUpload?: () => void
}

// ---------------------------------------------------------------------------
// MentionSuggestionsState (mirrors the State interface in useMentionSuggestions)
// ---------------------------------------------------------------------------

export interface MentionSuggestionsState {
  items: { path: string; kind: "file" | "dir" }[]
  loading: boolean
  error: string | null
}

const EMPTY_MENTION_ITEMS: { path: string; kind: "file" | "dir" }[] = []

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

// Attachment state slice
interface AttachmentsSlice {
  attachments: ComposerAttachment[]
  setAttachments: (
    updater: ComposerAttachment[] | ((current: ComposerAttachment[]) => ComposerAttachment[]),
  ) => void
}

// Selected attachment id slice
interface SelectedAttachmentSlice {
  selectedAttachmentId: string | null
  setSelectedAttachmentId: (id: string | null) => void
}

// Upload error slice
interface UploadErrorSlice {
  uploadError: string | null
  setUploadError: (error: string | null) => void
}

// Current text slice (live wire text from Lexical editor)
interface CurrentTextSlice {
  currentText: string
  setCurrentText: (text: string) => void
}

// Mention typeahead query slice
interface MentionQuerySlice {
  mentionQuery: string | null
  setMentionQuery: (query: string | null) => void
}

// Slash command typeahead query slice
interface SlashQuerySlice {
  slashQuery: string | null
  setSlashQuery: (query: string | null) => void
}

// Mention suggestions state slice
interface MentionSuggestionsSlice {
  mentionSuggestions: MentionSuggestionsState
  setMentionSuggestions: (state: MentionSuggestionsState) => void
}

// ---------------------------------------------------------------------------
// Combined store type
// ---------------------------------------------------------------------------

type ComposerState =
  & AttachmentsSlice
  & SelectedAttachmentSlice
  & UploadErrorSlice
  & CurrentTextSlice
  & MentionQuerySlice
  & SlashQuerySlice
  & MentionSuggestionsSlice

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const EMPTY_ATTACHMENTS: ComposerAttachment[] = []

export const useComposerStore = create<ComposerState>()((set) => ({
  // Attachments
  attachments: EMPTY_ATTACHMENTS,
  setAttachments: (updater) =>
    set((state) => ({
      attachments: typeof updater === "function" ? updater(state.attachments) : updater,
    })),

  // Selected attachment id
  selectedAttachmentId: null,
  setSelectedAttachmentId: (id) => set({ selectedAttachmentId: id }),

  // Upload error
  uploadError: null,
  setUploadError: (error) => set({ uploadError: error }),

  // Current text
  currentText: "",
  setCurrentText: (text) => set({ currentText: text }),

  // Mention typeahead query
  mentionQuery: null,
  setMentionQuery: (query) => set({ mentionQuery: query }),

  // Slash command typeahead query
  slashQuery: null,
  setSlashQuery: (query) => set({ slashQuery: query }),

  // Mention suggestions
  mentionSuggestions: { items: EMPTY_MENTION_ITEMS, loading: false, error: null },
  setMentionSuggestions: (suggState) => set({ mentionSuggestions: suggState }),
}))
