import { isInFlightStatus } from "../../shared/chat-status"
import type { DedupeRecord, DedupeStore, DedupeTarget } from "./remote-mcp-dedupe"
import { dedupeIdsOf } from "./remote-mcp-dedupe"
import { readChat } from "./remote-mcp-views"
import type { SnapshotReader } from "./remote-mcp-views"

const PROBE_RECENT_LIMIT = 1

export interface SendGuardHost extends SnapshotReader {
  dedupe: DedupeStore
}

export type GuardedDispatch =
  | { ok: false; message: string }
  | { ok: true; record: DedupeRecord }

export type GuardedOutcome =
  | { ok: false; message: string }
  | { ok: true; record: DedupeRecord; duplicateVia: "idempotencyKey" | "fingerprint" | null }

function isStillInFlight(host: SnapshotReader, record: DedupeRecord): boolean {
  const snapshot = readChat(host, record.chatId, PROBE_RECENT_LIMIT)
  if (!snapshot) return false
  if (isInFlightStatus(snapshot.runtime.status)) return true
  return record.queuedMessageId !== undefined && snapshot.queuedMessages.some((queued) => queued.id === record.queuedMessageId)
}

export async function guardedDispatch(
  host: SendGuardHost,
  target: DedupeTarget,
  idempotencyKey: string | undefined,
  dispatch: () => Promise<GuardedDispatch>,
): Promise<GuardedOutcome> {
  const ids = dedupeIdsOf(target, idempotencyKey)
  const existing = host.dedupe.find(ids)
  if (existing) {
    const earlier = await existing.record
    if (earlier && (existing.via === "idempotencyKey" || isStillInFlight(host, earlier))) {
      return { ok: true, record: earlier, duplicateVia: existing.via }
    }
  }
  const attempt = dispatch()
  host.dedupe.reserve(ids, attempt.then((result) => (result.ok ? result.record : null)))
  const result = await attempt
  return result.ok ? { ok: true, record: result.record, duplicateVia: null } : result
}
