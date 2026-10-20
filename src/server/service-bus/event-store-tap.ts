import { safeJsonParse, type JsonValue } from "../../shared/json"
import { busSubject, type BusEnvelope } from "../../shared/service-bus/envelope"
import type { TranscriptEntry } from "../../shared/types"
import { LOG_OF_EVENT, type StoreEvent } from "../events"
import type { BusSink } from "./service-bus"
import {
  storeEventChatId,
  storeEventEntityId,
  storeEventKind,
  storeEventSubject,
  storeEventTimestamp,
  TRANSCRIPT_BUS_KINDS,
} from "./store-event-subjects"

export interface EventStoreTap {
  onEventApplied(event: StoreEvent): void
  onEntryAppended(chatId: string, entry: TranscriptEntry): void
}

function toJsonValue(value: StoreEvent | TranscriptEntry): JsonValue {
  return safeJsonParse(JSON.stringify(value))
}

export function createBusTap(
  bus: BusSink,
  getProjectId: (chatId: string) => string | undefined,
  now: () => number,
): EventStoreTap {
  const projectOfChat = (chatId: string | undefined): string | undefined =>
    chatId === undefined ? undefined : getProjectId(chatId)

  return {
    onEventApplied(event) {
      const suffix = storeEventSubject(event)
      if (suffix === null) return
      const kind = storeEventKind(event)
      const chatId = storeEventChatId(event)
      const projectId = "projectId" in event ? event.projectId : projectOfChat(chatId)
      const envelope: BusEnvelope = {
        v: 1,
        id: crypto.randomUUID(),
        subject: busSubject(...suffix.split(".")),
        ts: now(),
        source: { kind: "store", log: LOG_OF_EVENT[kind] },
        direction: "internal",
        idempotencyKey: `store:${kind}:${storeEventEntityId(event)}:${storeEventTimestamp(event)}`,
        payload: toJsonValue(event),
        ...(chatId === undefined ? {} : { chatId }),
        ...(projectId === undefined ? {} : { projectId }),
      }
      bus.publish(envelope)
    },
    onEntryAppended(chatId, entry) {
      if (!TRANSCRIPT_BUS_KINDS.has(entry.kind)) return
      const projectId = projectOfChat(chatId)
      const envelope: BusEnvelope = {
        v: 1,
        id: crypto.randomUUID(),
        subject: busSubject("transcript", entry.kind),
        ts: now(),
        source: { kind: "transcript", chatId },
        direction: "internal",
        idempotencyKey: `transcript:${chatId}:${entry._id}`,
        chatId,
        payload: toJsonValue(entry),
        ...(projectId === undefined ? {} : { projectId }),
      }
      bus.publish(envelope)
    },
  }
}
