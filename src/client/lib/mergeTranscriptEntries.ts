import type { TranscriptEntry } from "../../shared/types"

export function mergeTranscriptEntries(olderEntries: TranscriptEntry[], recentEntries: TranscriptEntry[]): TranscriptEntry[] {
  const deduped = new Map<string, TranscriptEntry>()
  for (const entry of olderEntries) {
    deduped.set(entry._id, entry)
  }
  for (const entry of recentEntries) {
    deduped.set(entry._id, entry)
  }
  return [...deduped.values()]
}
