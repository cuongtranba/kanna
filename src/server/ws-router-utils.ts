import type { JsonObject } from "../shared/json"
import type { ServerWebSocket } from "bun"
import { log } from "../shared/log"
import type { SidebarData } from "../shared/types"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ServerEnvelope, SubscriptionTopic } from "../shared/protocol"
import type { EventStore } from "./event-store"


export interface ClientState {
  subscriptions: Map<string, SubscriptionTopic>
  snapshotSignatures: Map<string, string>
  chatOpSeqBySubId?: Map<string, number>
  backgroundTaskWatchers?: Map<string, () => void>
  protectedDraftChatIds?: Set<string>
  pushDeviceId?: string | null
  originHost?: string
}

export interface SnapshotBroadcastFilter {
  includeSidebar?: boolean
  includeLocalProjects?: boolean
  includeUpdate?: boolean
  includeKeybindings?: boolean
  includeAppSettings?: boolean
  includePushConfig?: boolean
  chatIds?: Set<string>
  projectIds?: Set<string>
  terminalIds?: Set<string>
}

export interface SnapshotComputationCache {
  sidebar?: {
    data: SidebarData
    signature: string
  }
  chatMetaOpsRecordedChatIds?: Set<string>
}


export function isSendToStartingProfilingEnabled(): boolean {
  return process.env.KANNA_PROFILE_SEND_TO_STARTING === "1"
}

export function logSendToStartingProfile(
  traceId: string | null | undefined,
  startedAt: number | null | undefined,
  stage: string,
  details?: JsonObject
): void {
  if (!traceId || startedAt === undefined || startedAt === null || !isSendToStartingProfilingEnabled()) {
    return
  }

  log.info("[kanna/send->starting][server]", JSON.stringify({
    traceId,
    stage,
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    ...details,
  }))
}


export function countSubscriptionsByTopic(ws: ServerWebSocket<ClientState>): {
  total: number
  sidebar: number
  chat: number
  projectGit: number
  projectCommands: number
  localProjects: number
  update: number
  keybindings: number
  appSettings: number
  terminal: number
} {
  let sidebar = 0
  let chat = 0
  let projectGit = 0
  let projectCommands = 0
  let localProjects = 0
  let update = 0
  let keybindings = 0
  let appSettings = 0
  let terminal = 0

  for (const topic of ws.data.subscriptions.values()) {
    switch (topic.type) {
      case "sidebar":
        sidebar += 1
        break
      case "chat":
        chat += 1
        break
      case "project-git":
        projectGit += 1
        break
      case "project-commands":
        projectCommands += 1
        break
      case "local-projects":
        localProjects += 1
        break
      case "update":
        update += 1
        break
      case "keybindings":
        keybindings += 1
        break
      case "app-settings":
        appSettings += 1
        break
      case "terminal":
        terminal += 1
        break
    }
  }

  return {
    total: ws.data.subscriptions.size,
    sidebar,
    chat,
    projectGit,
    projectCommands,
    localProjects,
    update,
    keybindings,
    appSettings,
    terminal,
  }
}


export function getSidebarProjectOrder(store: EventStore): string[] {
  return typeof store.getSidebarProjectOrder === "function"
    ? store.getSidebarProjectOrder()
    : []
}


const BENIGN_STALE_STATE_MESSAGES = [
  /^Chat not found$/,
  /^Queued message not found$/,
  /^File is no longer changed: /,
  /^Project not found$/,
] as const

export function isBenignStaleStateMessage(message: string): boolean {
  return BENIGN_STALE_STATE_MESSAGES.some((pattern) => pattern.test(message))
}


export function send(ws: ServerWebSocket<ClientState>, message: ServerEnvelope): number {
  const payload = JSON.stringify(message)
  ws.send(payload)
  return payload.length
}

export function ensureSnapshotSignatures(
  ws: ServerWebSocket<ClientState>
): Map<string, string> {
  if (!ws.data.snapshotSignatures) {
    ws.data.snapshotSignatures = new Map()
  }

  return ws.data.snapshotSignatures
}

export function ensureChatOpSeqMap(
  ws: ServerWebSocket<ClientState>
): Map<string, number> {
  if (!ws.data.chatOpSeqBySubId) {
    ws.data.chatOpSeqBySubId = new Map()
  }

  return ws.data.chatOpSeqBySubId
}


export function shouldIncludeTopic(
  topic: SubscriptionTopic,
  filter?: SnapshotBroadcastFilter
): boolean {
  if (!filter) {
    return true
  }

  if (topic.type === "sidebar") {
    return Boolean(filter.includeSidebar)
  }
  if (topic.type === "local-projects") {
    return Boolean(filter.includeLocalProjects)
  }
  if (topic.type === "update") {
    return Boolean(filter.includeUpdate)
  }
  if (topic.type === "keybindings") {
    return Boolean(filter.includeKeybindings)
  }
  if (topic.type === "app-settings") {
    return Boolean(filter.includeAppSettings)
  }
  if (topic.type === "push-config") {
    return Boolean(filter.includePushConfig)
  }
  if (topic.type === "chat") {
    return filter.chatIds?.has(topic.chatId) ?? false
  }
  if (topic.type === "project-git") {
    return filter.projectIds?.has(topic.projectId) ?? false
  }
  if (topic.type === "project-commands") {
    return filter.projectIds?.has(topic.projectId) ?? false
  }
  if (topic.type === "terminal") {
    return filter.terminalIds?.has(topic.terminalId) ?? false
  }

  return true
}

export function getStableChatSnapshotSignature(
  snapshot: Extract<ServerEnvelope, { type: "snapshot" }>["snapshot"]
): string {
  if (snapshot.type === "chat" && snapshot.data?.runtime) {
    const { timings: _t, ...stableRuntime } = snapshot.data.runtime
    return JSON.stringify({ type: snapshot.type, data: { ...snapshot.data, runtime: stableRuntime } })
  }
  return JSON.stringify(snapshot)
}

export { PROTOCOL_VERSION }
