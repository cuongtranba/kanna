import { randomUUID } from "node:crypto"
import type { TranscriptEntry } from "../shared/types"

export function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now(),
): T & { _id: string; createdAt: number } {
  return {
    _id: randomUUID(),
    createdAt,
    ...entry,
  }
}
