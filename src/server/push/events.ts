import type { PushSubscriptionRecord } from "../../shared/types"

export type PushEvent =
  | { kind: "subscription_added"; ts: number; id: string; record: PushSubscriptionRecord }
  | { kind: "subscription_removed"; ts: number; id: string; reason: "user_revoked" | "expired" | "replaced" }
  | { kind: "subscription_seen"; ts: number; id: string }
  | { kind: "project_mute_set"; ts: number; localPath: string; muted: boolean }

export interface PushEventStore {
  appendPushEvent(event: PushEvent): Promise<void>
  loadPushEvents(): Promise<PushEvent[]>
}
