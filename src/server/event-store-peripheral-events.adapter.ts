import type { StorageBackend } from "./storage/backend"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import { dropSharesOfDeletedChats, type ShareEvent } from "./session-share/share-projection"
import { dropUnmutedHistory, type PushEvent } from "./push/events"
import {
  applyTunnelEventToMap,
  loadPushEventsFromLog,
  loadShareEventsFromLog,
  loadTunnelEventsFromLog,
} from "./event-store-snapshot"


export interface PeripheralEventsDeps {
  readonly storage: StorageBackend
  readonly tunnelLogPath: string
  readonly sharesLogPath: string
  readonly pushLogPath: string
  readonly tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>
  isLiveChat: (chatId: string) => boolean
  readonly shareEventsAll: ShareEvent[]
  getWriteChain: () => Promise<void>
  setWriteChain: (p: Promise<void>) => void
}


export async function appendTunnelEvent(
  deps: PeripheralEventsDeps,
  event: CloudflareTunnelEvent,
): Promise<void> {
  const payload = `${JSON.stringify(event)}\n`
  const chain = deps.getWriteChain().then(async () => {
    await deps.storage.appendText(deps.tunnelLogPath, payload)
    applyTunnelEventToMap(deps.tunnelEventsByChatId, event)
  })
  deps.setWriteChain(chain)
  await chain
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
  await loadTunnelEventsFromLog(deps.storage, deps.tunnelLogPath, deps.tunnelEventsByChatId)
  const deadChatIds = [...deps.tunnelEventsByChatId.keys()].filter((chatId) => !deps.isLiveChat(chatId))
  if (deadChatIds.length === 0) return
  for (const chatId of deadChatIds) deps.tunnelEventsByChatId.delete(chatId)
  await rewriteLog(deps.storage, deps.tunnelLogPath, [...deps.tunnelEventsByChatId.values()].flat())
}

async function rewriteLog(storage: StorageBackend, filePath: string, events: readonly object[]): Promise<void> {
  await storage.writeText(filePath, events.map((event) => `${JSON.stringify(event)}\n`).join(""))
}


export async function appendShareEvent(
  deps: PeripheralEventsDeps,
  event: ShareEvent,
): Promise<void> {
  const payload = `${JSON.stringify(event)}\n`
  const chain = deps.getWriteChain().then(async () => {
    await deps.storage.appendText(deps.sharesLogPath, payload)
    deps.shareEventsAll.push(event)
  })
  deps.setWriteChain(chain)
  await chain
}

export function getShareEvents(deps: PeripheralEventsDeps): ShareEvent[] {
  return [...deps.shareEventsAll]
}

export async function loadShareEvents(deps: PeripheralEventsDeps): Promise<void> {
  const loaded: ShareEvent[] = []
  await loadShareEventsFromLog(deps.storage, deps.sharesLogPath, loaded)
  const kept = dropSharesOfDeletedChats(loaded, deps.isLiveChat)
  deps.shareEventsAll.push(...kept)
  if (kept.length !== loaded.length) await rewriteLog(deps.storage, deps.sharesLogPath, kept)
}


export async function appendPushEvent(
  deps: PeripheralEventsDeps,
  event: PushEvent,
): Promise<void> {
  const payload = `${JSON.stringify(event)}\n`
  const chain = deps.getWriteChain().then(async () => {
    await deps.storage.appendText(deps.pushLogPath, payload)
  })
  deps.setWriteChain(chain)
  await chain
}

export async function loadPushEvents(deps: PeripheralEventsDeps): Promise<PushEvent[]> {
  const loaded = await loadPushEventsFromLog(deps.storage, deps.pushLogPath)
  const kept = dropUnmutedHistory(loaded)
  if (kept.length !== loaded.length) {
    const chain = deps.getWriteChain().then(() => rewriteLog(deps.storage, deps.pushLogPath, kept))
    deps.setWriteChain(chain)
    await chain
  }
  return kept
}
