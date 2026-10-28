import type { AgentProvider, TranscriptEntry } from "../shared/types"
import type { StoreEvent, StoreState } from "./events"
import { isEventOf } from "./event-routes"
import {
  applyChatLifecycleEvent,
  applyChatMessageMetadata,
  applyAutoContinueToState,
  applyProjectEvent,
  applyStackEvent,
} from "./event-store-chat-lifecycle"
import { applySubagentEvent } from "./event-store-subagent"
import { applyChatTaskEvent } from "./event-store-tasks"
import { applyToolRequestEvent } from "./event-store-tool-requests"

export function applyStoreEvent(
  event: StoreEvent,
  state: StoreState,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
  replayChatProvider: Map<string, AgentProvider | null>,
): void {
  if (isEventOf("autoContinue", event)) {
    applyAutoContinueToState(state.autoContinueEventsByChatId, event)
  } else if (isEventOf("project", event)) {
    applyProjectEvent(state, event)
  } else if (isEventOf("chat", event)) {
    applyChatLifecycleEvent(state, replayChatProvider, event)
  } else if (isEventOf("message", event)) {
    applyChatMessageMetadata(state.chatsById, event.chatId, event.entry)
    const existing = legacyMessagesByChatId.get(event.chatId) ?? []
    existing.push({ ...event.entry })
    legacyMessagesByChatId.set(event.chatId, existing)
  } else if (isEventOf("stack", event)) {
    applyStackEvent(state.stacksById, event)
  } else if (isEventOf("subagent", event)) {
    applySubagentEvent(state.subagentRunsByChatId, event)
  } else if (isEventOf("toolRequest", event)) {
    applyToolRequestEvent(state.toolRequestsById, event)
  } else if (isEventOf("chatTask", event)) {
    applyChatTaskEvent(state.chatTasksByChatId, event)
  }
}
