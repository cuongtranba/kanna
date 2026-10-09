import { randomBytes } from "node:crypto"
import { TRANSFER_IDLE_TIMEOUT_MS, type TransferDirection } from "../shared/beacon-transfer"

export type TransferTicketState = "active" | "completed" | "failed"
export type TicketEndReason = "completed" | "failed" | "revoked" | "idle"

export interface TransferTicketSpec {
  beaconId: string
  chatId: string
  direction: TransferDirection
  kannaPath: string
  workspacePath: string
  beaconPath: string
  size?: number
  sha256?: string
  overwrite: boolean
  maxBytes?: number
}

export interface TransferOutcome {
  bytes: number
  sha256: string
}

export interface TransferTicket extends TransferTicketSpec {
  token: string
  state: TransferTicketState
  createdAt: number
  lastActivityAt: number
  outcome?: TransferOutcome
}

export type TicketEndListener = (reason: TicketEndReason) => void

export interface BeaconTransferTickets {
  mint(spec: TransferTicketSpec): TransferTicket
  lookup(token: string, direction: TransferDirection): TransferTicket | null
  inspect(token: string): TransferTicket | null
  touch(token: string): void
  complete(token: string, outcome: TransferOutcome): void
  fail(token: string): void
  revoke(token: string): void
  release(token: string): void
  watch(token: string, listener: TicketEndListener): () => void
  sweep(): void
}

interface TicketRecord {
  ticket: TransferTicket
  endedAt: number | null
  endReason: TicketEndReason | null
  listeners: Set<TicketEndListener>
}

function randomToken(): string {
  return randomBytes(32).toString("base64url")
}

export function createBeaconTransferTickets(
  deps: { now?: () => number; generateToken?: () => string; idleTimeoutMs?: number } = {},
): BeaconTransferTickets {
  const now = deps.now ?? Date.now
  const generateToken = deps.generateToken ?? randomToken
  const idleTimeoutMs = deps.idleTimeoutMs ?? TRANSFER_IDLE_TIMEOUT_MS
  const records = new Map<string, TicketRecord>()

  function end(record: TicketRecord, state: "completed" | "failed", reason: TicketEndReason): void {
    if (record.ticket.state !== "active") return
    record.ticket = { ...record.ticket, state }
    record.endedAt = now()
    record.endReason = reason
    for (const listener of [...record.listeners]) listener(reason)
  }

  function activeRecord(token: string): TicketRecord | null {
    const record = records.get(token)
    return record !== undefined && record.ticket.state === "active" ? record : null
  }

  return {
    mint(spec) {
      const at = now()
      const token = generateToken()
      const ticket: TransferTicket = { ...spec, token, state: "active", createdAt: at, lastActivityAt: at }
      records.set(token, { ticket, endedAt: null, endReason: null, listeners: new Set() })
      return ticket
    },
    lookup(token, direction) {
      const record = activeRecord(token)
      return record !== null && record.ticket.direction === direction ? record.ticket : null
    },
    inspect(token) {
      return records.get(token)?.ticket ?? null
    },
    touch(token) {
      const record = activeRecord(token)
      if (record !== null) record.ticket = { ...record.ticket, lastActivityAt: now() }
    },
    complete(token, outcome) {
      const record = records.get(token)
      if (record === undefined || record.ticket.state !== "active") return
      record.ticket = { ...record.ticket, outcome }
      end(record, "completed", "completed")
    },
    fail(token) {
      const record = records.get(token)
      if (record !== undefined) end(record, "failed", "failed")
    },
    revoke(token) {
      const record = records.get(token)
      if (record !== undefined) end(record, "failed", "revoked")
    },
    release(token) {
      records.delete(token)
    },
    watch(token, listener) {
      const record = records.get(token)
      if (record === undefined) return () => undefined
      if (record.endReason !== null) {
        listener(record.endReason)
        return () => undefined
      }
      record.listeners.add(listener)
      return () => {
        record.listeners.delete(listener)
      }
    },
    sweep() {
      const at = now()
      for (const [token, record] of [...records]) {
        if (record.ticket.state === "active") {
          if (at - record.ticket.lastActivityAt >= idleTimeoutMs) end(record, "failed", "idle")
          continue
        }
        if (record.endedAt !== null && at - record.endedAt >= idleTimeoutMs) records.delete(token)
      }
    },
  }
}
