import { createBusEnvelope } from "../../shared/service-bus/envelope"
import { subjectOfSuffix, transcriptBusSubject } from "../../shared/service-bus/subjects"
import type { TranscriptEntry } from "../../shared/types"
import { toJsonValue } from "../json-boundary"
import { LOG_OF_EVENT, storeEventKind, type StoreEvent } from "../events"
import type { BusSink } from "./service-bus"
import {
  storeEventChatId,
  storeEventEntityId,
  storeEventSubject,
  storeEventTimestamp,
  TRANSCRIPT_BUS_KINDS,
} from "./store-event-subjects"

export interface EventStoreTap {
  onEventApplied(event: StoreEvent): void
  onEntryAppended(chatId: string, entry: TranscriptEntry): void
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
      const envelope = createBusEnvelope({
        subject: subjectOfSuffix(suffix),
        ts: now(),
        source: { kind: "store", log: LOG_OF_EVENT[kind] },
        direction: "internal",
        idempotencyKey: `store:${kind}:${storeEventEntityId(event)}:${storeEventTimestamp(event)}`,
        payload: toJsonValue(event),
        ...(chatId === undefined ? {} : { chatId }),
        ...(projectId === undefined ? {} : { projectId }),
      })
      bus.publish(envelope)
    },
    onEntryAppended(chatId, entry) {
      if (!TRANSCRIPT_BUS_KINDS.has(entry.kind)) return
      const projectId = projectOfChat(chatId)
      const envelope = createBusEnvelope({
        subject: transcriptBusSubject(entry.kind),
        ts: now(),
        source: { kind: "transcript", chatId },
        direction: "internal",
        idempotencyKey: `transcript:${chatId}:${entry._id}`,
        chatId,
        payload: toJsonValue(entry),
        ...(projectId === undefined ? {} : { projectId }),
      })
      bus.publish(envelope)
    },
  }
}
