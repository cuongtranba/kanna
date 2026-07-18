/**
 * Tunnel, Share, and Push peripheral event operations extracted from
 * event-store.ts. All IO is performed through the injected StorageBackend.
 *
 * This module is an adapter (`.adapter.ts`) because it performs disk IO.
 * It must NOT import from event-store.ts (no circular deps).
 */
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

// ─── Deps interface ────────────────────────────────────────────────────────

export interface PeripheralEventsDeps {
  readonly storage: StorageBackend
  readonly tunnelLogPath: string
  readonly sharesLogPath: string
  readonly pushLogPath: string
  readonly tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>
  /** Mutable share events array — methods push into this directly. */
  readonly shareEventsAll: ShareEvent[]
  /** Read the current write-chain promise. */
  getWriteChain: () => Promise<void>
  /** Replace the write-chain promise (called inside async chain links). */
  setWriteChain: (p: Promise<void>) => void
}

// ─── Tunnel ────────────────────────────────────────────────────────────────

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

// ─── Share ─────────────────────────────────────────────────────────────────

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

// ─── Push ──────────────────────────────────────────────────────────────────

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
