import type { DatasetDecl } from "../../shared/genui"
import type { ChatMeta, FrozenDataset } from "../../shared/session-share/types"
import type { TranscriptEntry } from "../../shared/transcript-types"
import type { SnapshotSources } from "./snapshot-builder"

export interface SnapshotChatStore {
  getChat(chatId: string): { id: string; title?: string | null; createdAt?: number } | null
  getMessages(chatId: string): TranscriptEntry[]
}

export interface SnapshotDatasetFreezer {
  freeze(chatId: string, decl: DatasetDecl): Promise<FrozenDataset>
}

export function createSnapshotSources(store: SnapshotChatStore, datasets: SnapshotDatasetFreezer): SnapshotSources {
  return {
    getChatMeta(chatId): ChatMeta | null {
      const chat = store.getChat(chatId)
      if (!chat) return null
      const systemInit = store.getMessages(chatId).find((entry) => entry.kind === "system_init")
      const model = systemInit?.kind === "system_init" ? systemInit.model : "unknown"
      return { id: chat.id, title: chat.title ?? "Untitled chat", model, createdAt: chat.createdAt ?? 0 }
    },
    getTranscript: (chatId) => store.getMessages(chatId),
    freezeDataset: (chatId, decl) => datasets.freeze(chatId, decl),
    getAttachments: () => [],
  }
}
