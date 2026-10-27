import type { TranscriptEntry } from "./types"

export function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
) {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...entry,
  }
}
