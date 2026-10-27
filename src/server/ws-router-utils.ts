import type { CommandOrigin } from "../shared/command-origin"
import type { JsonObject } from "../shared/json"
import type { ServerWebSocket } from "bun"
import { log } from "../shared/log"
import type { SidebarData } from "../shared/types"
import type { ServerEnvelope, SubscriptionTopic } from "../shared/protocol"


export function unhandledCommandMessage(commandType: string): string {
  return `Command "${commandType}" was not handled by any ws-router handler. `
    + `Add a case for it in the ws-router-*.ts module that owns it.`
}

export interface ClientState {
  kind?: "browser"
  subscriptions: Map<string, SubscriptionTopic>
  snapshotSignatures: Map<string, string>
  chatOpSeqBySubId?: Map<string, number>
  backgroundTaskWatchers?: Map<string, () => void>
  protectedDraftChatIds?: Set<string>
  pushDeviceId?: string | null
  originHost?: string
  commandOrigin?: CommandOrigin
}

export interface BeaconHandshake {
  phase: "awaiting-hello" | "awaiting-auth" | "ready"
  beaconId?: string
  nonce?: string
  beaconVersion?: string
  protocolVersion?: number
}

export interface BeaconSocketState {
  kind: "beacon"
  originHost?: string
  beaconHandshake?: BeaconHandshake
}

export type SocketState = ClientState | BeaconSocketState

export function isBeaconSocket(ws: ServerWebSocket<SocketState>): ws is ServerWebSocket<BeaconSocketState> {
  return ws.data.kind === "beacon"
}

export function isBrowserSocket(ws: ServerWebSocket<SocketState>): ws is ServerWebSocket<ClientState> {
  return ws.data.kind !== "beacon"
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


export function countSubscriptionsByTopic(
  ws: ServerWebSocket<ClientState>,
): { total: number } & Partial<Record<SubscriptionTopic["type"], number>> {
  const counts: Partial<Record<SubscriptionTopic["type"], number>> = {}
  for (const topic of ws.data.subscriptions.values()) {
    counts[topic.type] = (counts[topic.type] ?? 0) + 1
  }
  return { total: ws.data.subscriptions.size, ...counts }
}


export interface CommandConnection {
  data: ClientState
  send(payload: string): number
  onSent?: (envelope: ServerEnvelope) => void
}

export function send(ws: CommandConnection, message: ServerEnvelope): number {
  const payload = JSON.stringify(message)
  ws.send(payload)
  ws.onSent?.(message)
  return payload.length
}

export function silentCommandMessage(commandType: string): string {
  return `Command "${commandType}" was claimed by a ws-router handler that sent no reply. `
    + `Every handler must answer with an ack, a snapshot or an error for the command id.`
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


type TopicByType = { [T in SubscriptionTopic as T["type"]]: T }

type TopicFilterTable = {
  [K in keyof TopicByType]: (topic: TopicByType[K], filter: SnapshotBroadcastFilter) => boolean
}

const REFRESHED_ON_EVERY_BROADCAST = () => true

const TOPIC_FILTER: TopicFilterTable = {
  "sidebar": (_topic, filter) => Boolean(filter.includeSidebar),
  "local-projects": (_topic, filter) => Boolean(filter.includeLocalProjects),
  "update": (_topic, filter) => Boolean(filter.includeUpdate),
  "keybindings": (_topic, filter) => Boolean(filter.includeKeybindings),
  "app-settings": (_topic, filter) => Boolean(filter.includeAppSettings),
  "push-config": (_topic, filter) => Boolean(filter.includePushConfig),
  "chat": (topic, filter) => filter.chatIds?.has(topic.chatId) ?? false,
  "project-git": (topic, filter) => filter.projectIds?.has(topic.projectId) ?? false,
  "project-commands": (topic, filter) => filter.projectIds?.has(topic.projectId) ?? false,
  "terminal": (topic, filter) => filter.terminalIds?.has(topic.terminalId) ?? false,
  "workflows": REFRESHED_ON_EVERY_BROADCAST,
  "boards": REFRESHED_ON_EVERY_BROADCAST,
  "board": REFRESHED_ON_EVERY_BROADCAST,
  "followed-sessions": REFRESHED_ON_EVERY_BROADCAST,
  "cron-jobs": REFRESHED_ON_EVERY_BROADCAST,
  "beacons": REFRESHED_ON_EVERY_BROADCAST,
  "background-task-output": REFRESHED_ON_EVERY_BROADCAST,
  "package-updates": REFRESHED_ON_EVERY_BROADCAST,
  "webhooks": REFRESHED_ON_EVERY_BROADCAST,
  "inbox": REFRESHED_ON_EVERY_BROADCAST,
  "mcp-sources": REFRESHED_ON_EVERY_BROADCAST,
  "service-bus": REFRESHED_ON_EVERY_BROADCAST,
}

function matchesTopicFilter<K extends keyof TopicByType>(
  type: K,
  topic: TopicByType[K],
  filter: SnapshotBroadcastFilter,
): boolean {
  return TOPIC_FILTER[type](topic, filter)
}

export function shouldIncludeTopic(
  topic: SubscriptionTopic,
  filter?: SnapshotBroadcastFilter
): boolean {
  if (!filter) {
    return true
  }
  return matchesTopicFilter(topic.type, topic, filter)
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
