import type { PushSubscriptionRecord } from "../../shared/types"

export type PushEvent =
  | { kind: "subscription_added"; ts: number; id: string; record: PushSubscriptionRecord }
  | { kind: "subscription_removed"; ts: number; id: string; reason: "user_revoked" | "expired" | "replaced" }
  | { kind: "subscription_seen"; ts: number; id: string }
  | { kind: "project_mute_set"; ts: number; localPath: string; muted: boolean }
  | { kind: "chat_mute_set"; ts: number; chatId: string; muted: boolean }

function muteKeyOf(event: PushEvent): { key: string; muted: boolean } | null {
  if (event.kind === "project_mute_set") return { key: `project:${event.localPath}`, muted: event.muted }
  if (event.kind === "chat_mute_set") return { key: `chat:${event.chatId}`, muted: event.muted }
  return null
}

export function dropUnmutedHistory(events: readonly PushEvent[]): PushEvent[] {
  const latest = new Map<string, boolean>()
  for (const event of events) {
    const mute = muteKeyOf(event)
    if (mute) latest.set(mute.key, mute.muted)
  }
  return events.filter((event) => {
    const mute = muteKeyOf(event)
    return !mute || latest.get(mute.key) === true
  })
}

export interface PushEventStore {
  appendPushEvent(event: PushEvent): Promise<void>
  loadPushEvents(): Promise<PushEvent[]>
}
