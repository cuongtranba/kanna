import { createHash } from "node:crypto"

export const DEDUPE_TTL_MS = 30 * 60 * 1000
export const DEDUPE_CAPACITY = 256

export type DedupeScope = "send" | "enqueue"

export interface DedupeRecord {
  chatId: string
  queuedMessageId?: string
  baseline: number
}

export interface DedupeIds {
  idempotency?: string
  fingerprint: string
}

export interface DedupeSlot {
  via: "idempotencyKey" | "fingerprint"
  record: Promise<DedupeRecord | null>
}

export interface DedupeStore {
  find(ids: DedupeIds): DedupeSlot | null
  reserve(ids: DedupeIds, record: Promise<DedupeRecord | null>): void
}

interface StoredSlot extends DedupeSlot {
  storedAt: number
}

export interface DedupeTarget {
  scope: DedupeScope
  clientId: string
  chatId?: string
  projectId?: string
  content: string
}

export function dedupeIdsOf(target: DedupeTarget, idempotencyKey: string | undefined): DedupeIds {
  const destination = target.chatId ? `chat:${target.chatId}` : `project:${target.projectId ?? ""}`
  const contentHash = createHash("sha256").update(target.content).digest("hex")
  const ids: DedupeIds = { fingerprint: `${target.scope}|${target.clientId}|${destination}|${contentHash}` }
  return idempotencyKey ? { ...ids, idempotency: `${target.scope}|${target.clientId}|${idempotencyKey}` } : ids
}

export function createDedupeStore(options: { now: () => number; ttlMs?: number; capacity?: number }): DedupeStore {
  const ttlMs = options.ttlMs ?? DEDUPE_TTL_MS
  const capacity = options.capacity ?? DEDUPE_CAPACITY
  const slots = new Map<string, StoredSlot>()

  function live(id: string): StoredSlot | null {
    const slot = slots.get(id)
    if (!slot) return null
    if (options.now() - slot.storedAt > ttlMs) {
      slots.delete(id)
      return null
    }
    return slot
  }

  function store(id: string, via: DedupeSlot["via"], record: Promise<DedupeRecord | null>) {
    const slot: StoredSlot = { via, record, storedAt: options.now() }
    slots.delete(id)
    slots.set(id, slot)
    while (slots.size > capacity) {
      const oldest = slots.keys().next()
      if (oldest.done) break
      slots.delete(oldest.value)
    }
    void record.then((resolved) => {
      if (resolved === null && slots.get(id) === slot) slots.delete(id)
    }, () => {
      if (slots.get(id) === slot) slots.delete(id)
    })
  }

  return {
    find(ids) {
      if (ids.idempotency) return live(ids.idempotency)
      return live(ids.fingerprint)
    },
    reserve(ids, record) {
      if (ids.idempotency) store(ids.idempotency, "idempotencyKey", record)
      store(ids.fingerprint, "fingerprint", record)
    },
  }
}
