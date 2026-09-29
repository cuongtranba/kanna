import { datasetFreezeKey, extractKannaUiFences, parseGenUISpec, type DatasetDecl } from "../../shared/genui"
import {
  CHAT_SNAPSHOT_VERSION,
  type AttachmentManifestEntry,
  type ChatMeta,
  type ChatSnapshotV2,
  type FrozenDataset,
} from "../../shared/session-share/types"
import type { TranscriptEntry } from "../../shared/transcript-types"
import { shareableEntries } from "./shareable-entries"

export interface SnapshotSources {
  getChatMeta(chatId: string): ChatMeta | null
  getTranscript(chatId: string): TranscriptEntry[]
  freezeDataset(chatId: string, decl: DatasetDecl): Promise<FrozenDataset>
  getAttachments(chatId: string): AttachmentManifestEntry[]
}

function viewDatasets(entries: readonly TranscriptEntry[]): Map<string, DatasetDecl> {
  const found = new Map<string, DatasetDecl>()
  for (const entry of entries) {
    if (entry.kind !== "assistant_text") continue
    for (const fence of extractKannaUiFences(entry.text)) {
      if (!fence.closed) continue
      const parsed = parseGenUISpec(fence.source)
      if (!parsed.ok) continue
      for (const decl of Object.values(parsed.spec.datasets ?? {})) {
        if (decl.source !== "inline") found.set(datasetFreezeKey(decl), decl)
      }
    }
  }
  return found
}

async function freezeDatasets(
  sources: SnapshotSources,
  chatId: string,
  entries: readonly TranscriptEntry[],
): Promise<Record<string, FrozenDataset>> {
  const frozen = await Promise.all([...viewDatasets(entries)].map(async ([key, decl]) =>
    [key, await sources.freezeDataset(chatId, decl)] as const))
  return Object.fromEntries(frozen)
}

export async function buildChatSnapshot(sources: SnapshotSources, chatId: string): Promise<ChatSnapshotV2> {
  const meta = sources.getChatMeta(chatId)
  if (!meta) {
    throw new Error(`chat_not_found:${chatId}`)
  }
  const entries = shareableEntries(sources.getTranscript(chatId))
  return {
    version: CHAT_SNAPSHOT_VERSION,
    chatMeta: meta,
    entries,
    datasets: await freezeDatasets(sources, chatId, entries),
    attachmentsManifest: sources.getAttachments(chatId),
  }
}
