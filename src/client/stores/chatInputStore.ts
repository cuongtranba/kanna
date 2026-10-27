import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SerializedEditorState } from "lexical"
import type { UploadedAttachment } from "../../shared/types"
import { omitKey } from "../lib/recordOps"


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
  attachmentDrafts: Record<string, UploadedAttachment[]>

  setDraft: (chatId: string, valueOrState: SerializedEditorState | string, text?: string) => void

  clearDraft: (chatId: string) => void

  getDraft: (chatId: string) => DraftEntry | null

  setAttachmentDrafts: (chatId: string, attachments: UploadedAttachment[]) => void
  clearAttachmentDrafts: (chatId: string) => void
  getAttachmentDrafts: (chatId: string) => UploadedAttachment[]
  forgetChats: (chatIds: readonly string[]) => void
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
              return { drafts: omitKey(state.drafts, chatId) }
            }
            entry = { text: valueOrState }
          } else {
            const plainText = text ?? ""
            if (!plainText) {
              return { drafts: omitKey(state.drafts, chatId) }
            }
            entry = { text: plainText, lexicalState: valueOrState }
          }

          return { drafts: { ...state.drafts, [chatId]: entry } }
        }),

      clearDraft: (chatId) =>
        set((state) => {
          return { drafts: omitKey(state.drafts, chatId) }
        }),

      getDraft: (chatId) => normalizeDraft(get().drafts[chatId]),

      setAttachmentDrafts: (chatId, attachments) =>
        set((state) => {
          if (attachments.length === 0) {
            return { attachmentDrafts: omitKey(state.attachmentDrafts, chatId) }
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
          return { attachmentDrafts: omitKey(state.attachmentDrafts, chatId) }
        }),

      getAttachmentDrafts: (chatId) => get().attachmentDrafts[chatId] ?? [],

      forgetChats: (chatIds) =>
        set((state) => ({
          drafts: Object.fromEntries(Object.entries(state.drafts).filter(([chatId]) => !chatIds.includes(chatId))),
          attachmentDrafts: Object.fromEntries(
            Object.entries(state.attachmentDrafts).filter(([chatId]) => !chatIds.includes(chatId)),
          ),
        })),
    }),
    {
      name: "chat-input-drafts",
    },
  ),
)
