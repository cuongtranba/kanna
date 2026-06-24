import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SerializedEditorState } from "lexical"
import type { ChatAttachment } from "../../shared/types"

// ---------------------------------------------------------------------------
// Draft shape
// ---------------------------------------------------------------------------

/**
 * A draft can be stored in two ways:
 *  - `DraftEntry` (new): carries the full Lexical serialized state + the
 *    plain-text representation for back-compat reads.
 *  - `string` (legacy localStorage): stored as a plain string; hydrated as
 *    `{ text: value }` with no `lexicalState`.
 *
 * `getDraft` always returns `DraftEntry | null`.
 */
export interface DraftEntry {
  text: string
  lexicalState?: SerializedEditorState
}

/** The persisted union type: new entries are DraftEntry, legacy are string. */
type PersistedDraft = DraftEntry | string

function normalizeDraft(value: PersistedDraft | undefined): DraftEntry | null {
  if (value === undefined) return null
  if (typeof value === "string") {
    return value ? { text: value } : null
  }
  return value.text || value.lexicalState ? value : null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ChatInputState {
  drafts: Record<string, PersistedDraft>
  attachmentDrafts: Record<string, ChatAttachment[]>

  /**
   * Persists the editor state as a DraftEntry for a given chatId.
   * Accepts either a full SerializedEditorState + text (new path) or
   * a plain string (back-compat — still accepted for legacy callers).
   */
  setDraft: (chatId: string, valueOrState: SerializedEditorState | string, text?: string) => void

  clearDraft: (chatId: string) => void

  /**
   * Returns the DraftEntry for a chatId, or null if none exists.
   * Legacy string drafts are wrapped in `{ text }` automatically.
   */
  getDraft: (chatId: string) => DraftEntry | null

  setAttachmentDrafts: (chatId: string, attachments: ChatAttachment[]) => void
  clearAttachmentDrafts: (chatId: string) => void
  getAttachmentDrafts: (chatId: string) => ChatAttachment[]
}

export const useChatInputStore = create<ChatInputState>()(
  persist(
    (set, get) => ({
      drafts: {},
      attachmentDrafts: {},

      setDraft: (chatId, valueOrState, text) =>
        set((state) => {
          let entry: PersistedDraft

          if (typeof valueOrState === "string") {
            // Back-compat: plain string passed (e.g. previousPrompt hydration)
            if (!valueOrState) {
              const { [chatId]: _, ...rest } = state.drafts
              return { drafts: rest }
            }
            entry = { text: valueOrState }
          } else {
            // New path: SerializedEditorState + plain text
            const plainText = text ?? ""
            if (!plainText) {
              // Empty editor — clear the draft
              const { [chatId]: _, ...rest } = state.drafts
              return { drafts: rest }
            }
            entry = { text: plainText, lexicalState: valueOrState }
          }

          return { drafts: { ...state.drafts, [chatId]: entry } }
        }),

      clearDraft: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.drafts
          return { drafts: rest }
        }),

      getDraft: (chatId) => normalizeDraft(get().drafts[chatId]),

      setAttachmentDrafts: (chatId, attachments) =>
        set((state) => {
          if (attachments.length === 0) {
            const { [chatId]: _, ...rest } = state.attachmentDrafts
            return { attachmentDrafts: rest }
          }
          return {
            attachmentDrafts: {
              ...state.attachmentDrafts,
              [chatId]: attachments,
            },
          }
        }),

      clearAttachmentDrafts: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.attachmentDrafts
          return { attachmentDrafts: rest }
        }),

      getAttachmentDrafts: (chatId) => get().attachmentDrafts[chatId] ?? [],
    }),
    {
      name: "chat-input-drafts",
    },
  ),
)
