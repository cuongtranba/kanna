import type { JsonObject } from "../../shared/json"
import { log } from "../../shared/log"
import type { ServerEnvelope } from "../../shared/protocol"
import { localStorageAdapter, sessionStorageAdapter } from "../adapters/storage.adapter"
import type { StoragePort } from "../ports/storagePort"

const PROFILE_STORAGE_KEY = "kanna:profile-send-to-starting"
const TRACE_LOG_LABEL = "[kanna/send->starting][client]"
const FRAME_LOG_LABEL = "[kanna/send->starting][client-ws]"

interface SendToStartingTrace {
  traceId: string
  startedAt: number
  serverChatId: string | null
  routeChatIdAtSend: string | null
  stages: Set<string>
}

export interface FrameReceipt {
  receivedAt: number
  bytes: number
}

export interface SendToStartingProfiler {
  begin(args: { traceId: string; chatId: string | null; details: JsonObject }): void
  note(traceId: string, stage: string, details?: JsonObject): void
  acknowledge(traceId: string, chatId: string, details?: JsonObject): void
  fail(traceId: string, message: string): void
  mark(chatId: string, stage: string, details?: JsonObject): void
  end(chatId: string, stage: string, details?: JsonObject): void
  observeFrame(frame: ServerEnvelope, receipt: FrameReceipt): void
}

export function createSendToStartingProfiler(storages: readonly StoragePort[]): SendToStartingProfiler {
  const traces = new Map<string, SendToStartingTrace>()

  function isEnabled(): boolean {
    try {
      return storages.some((storage) => storage.getItem(PROFILE_STORAGE_KEY) === "1")
    } catch {
      return false
    }
  }

  function latestTraceFor(chatId: string): SendToStartingTrace | undefined {
    let latest: SendToStartingTrace | undefined
    for (const trace of traces.values()) {
      if (trace.serverChatId !== chatId) continue
      if (!latest || trace.startedAt > latest.startedAt) latest = trace
    }
    return latest
  }

  function elapsedMs(trace: SendToStartingTrace): number {
    return Number((performance.now() - trace.startedAt).toFixed(1))
  }

  function emit(trace: SendToStartingTrace, stage: string, details?: JsonObject): void {
    log.debug(TRACE_LOG_LABEL, {
      traceId: trace.traceId,
      stage,
      elapsedMs: elapsedMs(trace),
      serverChatId: trace.serverChatId,
      routeChatIdAtSend: trace.routeChatIdAtSend,
      ...details,
    })
  }

  return {
    begin({ traceId, chatId, details }) {
      if (!isEnabled()) return
      const trace: SendToStartingTrace = {
        traceId,
        startedAt: performance.now(),
        serverChatId: chatId,
        routeChatIdAtSend: chatId,
        stages: new Set(),
      }
      traces.set(traceId, trace)
      emit(trace, "handle_send_called", details)
    },

    note(traceId, stage, details) {
      const trace = traces.get(traceId)
      if (trace) emit(trace, stage, details)
    },

    acknowledge(traceId, chatId, details) {
      const trace = traces.get(traceId)
      if (!trace) return
      trace.serverChatId = chatId
      emit(trace, "chat_send_ack_received", { resultChatId: chatId, ...details })
    },

    fail(traceId, message) {
      const trace = traces.get(traceId)
      if (!trace) return
      emit(trace, "handle_send_failed", { error: message })
      traces.delete(traceId)
    },

    mark(chatId, stage, details) {
      const trace = latestTraceFor(chatId)
      if (!trace || trace.stages.has(stage)) return
      trace.stages.add(stage)
      emit(trace, stage, details)
    },

    end(chatId, stage, details) {
      const trace = latestTraceFor(chatId)
      if (!trace) return
      emit(trace, stage, { ...details, totalMs: elapsedMs(trace) })
      traces.delete(trace.traceId)
    },

    observeFrame(frame, receipt) {
      if (!isEnabled()) return
      if (frame.type === "snapshot" && frame.snapshot.type === "chat" && frame.snapshot.data?.runtime.status === "starting") {
        log.debug(FRAME_LOG_LABEL, {
          stage: "socket_message_received",
          receivedAt: receipt.receivedAt,
          payloadBytes: receipt.bytes,
          chatId: frame.snapshot.data.runtime.chatId,
          status: frame.snapshot.data.runtime.status,
          messageCount: frame.snapshot.data.messages.length,
        })
      }
      if (frame.type === "ack") {
        log.debug(FRAME_LOG_LABEL, {
          stage: "socket_ack_received",
          receivedAt: receipt.receivedAt,
          payloadBytes: receipt.bytes,
          commandId: frame.id,
        })
      }
    },
  }
}

export const sendToStartingProfiler = createSendToStartingProfiler([sessionStorageAdapter, localStorageAdapter])
