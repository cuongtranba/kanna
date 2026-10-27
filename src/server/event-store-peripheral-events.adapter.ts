import type { StorageBackend } from "./storage/backend"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import { dropSharesOfDeletedChats, type ShareEvent } from "./session-share/share-projection"
import { dropUnmutedHistory, type PushEvent } from "./push/events"
import type { StoreLayout } from "./event-logs"
import type { LogWriter } from "./event-store-writer"
import { readJsonlSkippingCorrupt, writeJsonl } from "./jsonl-log"


export interface PeripheralEventsDeps {
  readonly storage: StorageBackend
  readonly layout: StoreLayout
  readonly writer: LogWriter
  readonly tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>
  isLiveChat: (chatId: string) => boolean
  readonly shareEventsAll: ShareEvent[]
}

function applyTunnelEventToMap(
  tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>,
  event: CloudflareTunnelEvent,
): void {
  const existing = tunnelEventsByChatId.get(event.chatId) ?? []
  existing.push(event)
  tunnelEventsByChatId.set(event.chatId, existing)
}


export async function appendTunnelEvent(
  deps: PeripheralEventsDeps,
  event: CloudflareTunnelEvent,
): Promise<void> {
  await deps.writer.append(deps.layout.logPath("tunnels"), event, () => {
    applyTunnelEventToMap(deps.tunnelEventsByChatId, event)
  })
}

export function getTunnelEvents(
  deps: PeripheralEventsDeps,
  chatId: string,
): CloudflareTunnelEvent[] {
  const list = deps.tunnelEventsByChatId.get(chatId)
  return list ? [...list] : []
}

export function listTunnelChats(deps: PeripheralEventsDeps): string[] {
  return [...deps.tunnelEventsByChatId.keys()]
}

export async function loadTunnelEvents(deps: PeripheralEventsDeps): Promise<void> {
  const logPath = deps.layout.logPath("tunnels")
  for (const event of await readJsonlSkippingCorrupt<CloudflareTunnelEvent>(deps.storage, logPath)) {
    applyTunnelEventToMap(deps.tunnelEventsByChatId, event)
  }
  const deadChatIds = [...deps.tunnelEventsByChatId.keys()].filter((chatId) => !deps.isLiveChat(chatId))
  if (deadChatIds.length === 0) return
  for (const chatId of deadChatIds) deps.tunnelEventsByChatId.delete(chatId)
  await writeJsonl(deps.storage, logPath, [...deps.tunnelEventsByChatId.values()].flat())
}


export async function appendShareEvent(
  deps: PeripheralEventsDeps,
  event: ShareEvent,
): Promise<void> {
  await deps.writer.append(deps.layout.logPath("shares"), event, () => {
    deps.shareEventsAll.push(event)
  })
}

export function getShareEvents(deps: PeripheralEventsDeps): ShareEvent[] {
  return [...deps.shareEventsAll]
}

export async function loadShareEvents(deps: PeripheralEventsDeps): Promise<void> {
  const logPath = deps.layout.logPath("shares")
  const loaded = await readJsonlSkippingCorrupt<ShareEvent>(deps.storage, logPath)
  const kept = dropSharesOfDeletedChats(loaded, deps.isLiveChat)
  deps.shareEventsAll.push(...kept)
  if (kept.length !== loaded.length) await writeJsonl(deps.storage, logPath, kept)
}


export async function appendPushEvent(
  deps: PeripheralEventsDeps,
  event: PushEvent,
): Promise<void> {
  await deps.writer.append(deps.layout.logPath("push"), event)
}

export async function loadPushEvents(deps: PeripheralEventsDeps): Promise<PushEvent[]> {
  const logPath = deps.layout.logPath("push")
  const loaded = await readJsonlSkippingCorrupt<PushEvent>(deps.storage, logPath)
  const kept = dropUnmutedHistory(loaded)
  if (kept.length !== loaded.length) {
    await deps.writer.serialize(() => writeJsonl(deps.storage, logPath, kept))
  }
  return kept
}
