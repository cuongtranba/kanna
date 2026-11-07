import { randomUUID } from "node:crypto"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { namedBusSubject, type BusSubjectName } from "../../shared/service-bus/subjects"
import { redactSecrets } from "./redact-secrets"

export const EVENT_FEED_CAPACITY = 2000
export const EVENT_FEED_DEFAULT_LIMIT = 100

const FEED_SUBJECT_NAMES: readonly BusSubjectName[] = [
  "turnStarted",
  "turnFinished",
  "turnFailed",
  "turnCancelled",
  "chatCreated",
  "chatToolPending",
  "chatToolResolved",
  "cronRunStarted",
  "cronRunOutcome",
  "cronRunSkipped",
]

export const EVENT_FEED_SUBJECTS: readonly string[] = FEED_SUBJECT_NAMES.map(namedBusSubject)

const ADMITTED_SUBJECTS: ReadonlySet<string> = new Set(EVENT_FEED_SUBJECTS)

const CURSOR_SEPARATOR = ":"

export interface EventFeedEntry {
  seq: number
  envelope: BusEnvelope
}

export interface EventFeedPage {
  cursor: string
  reset: boolean
  dropped: number
  events: readonly EventFeedEntry[]
}

export interface EventFeed {
  append(envelope: BusEnvelope): boolean
  read(after: string | null, limit?: number): EventFeedPage
  waitFor(after: string | null, timeoutMs: number): Promise<EventFeedPage>
}

export interface EventFeedOptions {
  capacity?: number
  newBootId?: () => string
}

type ParsedCursor = { kind: "none" } | { kind: "foreign" } | { kind: "own"; seq: number }

export function createEventFeed(options: EventFeedOptions = {}): EventFeed {
  const capacity = options.capacity ?? EVENT_FEED_CAPACITY
  const bootId = (options.newBootId ?? randomUUID)()
  const ring: EventFeedEntry[] = []
  let lastSeq = 0
  let waiters: Array<() => void> = []

  const cursorOf = (seq: number) => `${bootId}${CURSOR_SEPARATOR}${seq}`

  function parse(after: string | null): ParsedCursor {
    if (after === null) return { kind: "none" }
    const split = after.lastIndexOf(CURSOR_SEPARATOR)
    if (split < 0 || after.slice(0, split) !== bootId) return { kind: "foreign" }
    const digits = after.slice(split + 1)
    if (!/^\d+$/.test(digits)) return { kind: "foreign" }
    const seq = Number(digits)
    return Number.isSafeInteger(seq) && seq <= lastSeq ? { kind: "own", seq } : { kind: "foreign" }
  }

  function tail(limit: number): readonly EventFeedEntry[] {
    return ring.slice(Math.max(0, ring.length - limit))
  }

  function read(after: string | null, limit = EVENT_FEED_DEFAULT_LIMIT): EventFeedPage {
    const size = Math.max(1, Math.min(limit, capacity))
    const position = parse(after)
    if (position.kind !== "own") {
      return { cursor: cursorOf(lastSeq), reset: position.kind === "foreign", dropped: 0, events: tail(size) }
    }
    const oldestRetained = ring[0]?.seq ?? lastSeq + 1
    const dropped = Math.max(0, oldestRetained - 1 - position.seq)
    const events = ring.filter((entry) => entry.seq > position.seq).slice(0, size)
    const last = events[events.length - 1]
    return { cursor: cursorOf(last ? last.seq : position.seq), reset: false, dropped, events }
  }

  return {
    append(envelope) {
      if (!ADMITTED_SUBJECTS.has(envelope.subject)) return false
      lastSeq += 1
      ring.push({ seq: lastSeq, envelope: { ...envelope, payload: redactSecrets(envelope.payload) } })
      while (ring.length > capacity) ring.shift()
      const woken = waiters
      waiters = []
      for (const wake of woken) wake()
      return true
    },
    read,
    async waitFor(after, timeoutMs) {
      const baseline = after ?? cursorOf(lastSeq)
      const ready = read(baseline)
      if (ready.reset || ready.events.length > 0) return ready
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter !== wake)
          resolve()
        }, timeoutMs)
        waiters.push(wake)
      })
      return read(baseline)
    },
  }
}
