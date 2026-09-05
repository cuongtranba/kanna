import type { StorageBackend } from "./storage/backend"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
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
  await loadShareEventsFromLog(deps.storage, deps.sharesLogPath, deps.shareEventsAll)
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
  return loadPushEventsFromLog(deps.storage, deps.pushLogPath)
}
