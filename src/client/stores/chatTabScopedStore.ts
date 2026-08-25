import { createScopedStore } from "../lib/createScopedStore"
import type { ChatAttachment } from "../../shared/types"

// ---------------------------------------------------------------------------
// Re-exported types (formerly in composerStore — kept here for consumers)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stable empty sentinels (avoid inline `?? []` / `?? {}` — React #185)
// ---------------------------------------------------------------------------

const EMPTY_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_MENTION_ITEMS: { path: string; kind: "file" | "dir" }[] = []
const EMPTY_TOOL_GROUP_EXPANDED: Record<string, boolean> = {}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface ChatTabScopedState {
  // ─── Tool group expanded (ChatTranscriptViewport accordion) ──────────────
  toolGroupExpanded: Record<string, boolean>
  setToolGroupExpanded: (
    updater: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void
  resetToolGroupExpanded: () => void

  // ─── Input height (transcript padding-bottom) ─────────────────────────────
  inputHeight: number
  setInputHeight: (height: number) => void

  // ─── Scroll to bottom button ──────────────────────────────────────────────
  showScrollToBottom: boolean
  setShowScrollToBottom: (show: boolean) => void

  // ─── Composer: attachments ────────────────────────────────────────────────
  attachments: ComposerAttachment[]
  setAttachments: (
    updater: ComposerAttachment[] | ((current: ComposerAttachment[]) => ComposerAttachment[]),
  ) => void

  // ─── Composer: selected attachment id ────────────────────────────────────
  selectedAttachmentId: string | null
  setSelectedAttachmentId: (id: string | null) => void

  // ─── Composer: upload error ───────────────────────────────────────────────
  uploadError: string | null
  setUploadError: (error: string | null) => void

  // ─── Composer: live text from the Lexical editor ─────────────────────────
  currentText: string
  setCurrentText: (text: string) => void

  // ─── Composer: mention typeahead query ───────────────────────────────────
  mentionQuery: string | null
  setMentionQuery: (query: string | null) => void

  // ─── Composer: slash-command typeahead query ──────────────────────────────
  slashQuery: string | null
  setSlashQuery: (query: string | null) => void

  // ─── Composer: mention suggestions (fetched async by useMentionSuggestions)
  mentionSuggestions: MentionSuggestionsState
  setMentionSuggestions: (state: MentionSuggestionsState) => void

  // ─── Chat navbar: share popover ────────────────────────────────────────────
  sharePopoverOpen: boolean
  setSharePopoverOpen: (open: boolean) => void
  chatSettingsOpen: boolean
  setChatSettingsOpen: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// Scoped store
//
// `void` init — no configuration needed at mount time; all defaults are
// hard-coded (same pattern as paneScopedStore).
// ---------------------------------------------------------------------------

export const ChatTabScopedStore = createScopedStore<void, ChatTabScopedState>(
  "ChatTabScoped",
  () => (set) => ({
    // Tool group expanded
    toolGroupExpanded: EMPTY_TOOL_GROUP_EXPANDED,
    setToolGroupExpanded: (updater) =>
      set((state) => ({ toolGroupExpanded: updater(state.toolGroupExpanded) })),
    resetToolGroupExpanded: () => set({ toolGroupExpanded: EMPTY_TOOL_GROUP_EXPANDED }),

    // Input height (default matches the legacy chatPageStore default)
    inputHeight: 148,
    setInputHeight: (height) => set({ inputHeight: height }),

    // Scroll to bottom
    showScrollToBottom: false,
    setShowScrollToBottom: (show) => set({ showScrollToBottom: show }),

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

    // Share popover open
    sharePopoverOpen: false,
    setSharePopoverOpen: (open) => set({ sharePopoverOpen: open }),
    chatSettingsOpen: false,
    setChatSettingsOpen: (open) => set({ chatSettingsOpen: open }),
  }),
)
