import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SerializedEditorState } from "lexical"
import type { ChatAttachment } from "../../shared/types"


export interface DraftEntry {
  text: string
  lexicalState?: SerializedEditorState
}

type PersistedDraft = DraftEntry | string

function normalizeDraft(value: PersistedDraft | undefined): DraftEntry | null {
  if (value === undefined) return null
  if (typeof value === "string") {
    return value ? { text: value } : null
  }
  return value.text || value.lexicalState ? value : null
}


interface ChatInputState {
  drafts: Record<string, PersistedDraft>
  attachmentDrafts: Record<string, ChatAttachment[]>

  setDraft: (chatId: string, valueOrState: SerializedEditorState | string, text?: string) => void

  clearDraft: (chatId: string) => void

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
            if (!valueOrState) {
              const { [chatId]: _, ...rest } = state.drafts
              return { drafts: rest }
            }
            entry = { text: valueOrState }
          } else {
            const plainText = text ?? ""
            if (!plainText) {
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
