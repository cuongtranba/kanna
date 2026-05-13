import { randomUUID } from "node:crypto"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import type { CloudflareTunnelEvent } from "./events"
import { CLOUDFLARE_TUNNEL_EVENT_VERSION } from "./events"
import { TunnelLifecycle } from "./lifecycle"
import { deriveChatTunnels } from "./read-model"
import { TunnelManager } from "./tunnel-manager"

export interface TunnelGatewayArgs {
  manager: TunnelManager
  lifecycle: TunnelLifecycle
  settings: AppSettingsManager
  store: EventStore
  broadcast: (chatId: string) => void
  now?: () => number
}

export type ProposeOutcome =
  | { status: "proposed"; tunnelId: string; port: number }
  | { status: "already_live"; tunnelId: string; port: number; url: string | null }
  | { status: "disabled" }
  | { status: "invalid_port"; reason: string }

const MIN_PORT = 1
const MAX_PORT = 65535

export class TunnelGateway {
  private readonly manager: TunnelManager
  private readonly lifecycle: TunnelLifecycle
  private readonly settings: AppSettingsManager
  private readonly store: EventStore
  private readonly broadcast: (chatId: string) => void
  private readonly now: () => number
  private readonly proposedSourcePid = new Map<string, number | null>()

  constructor(args: TunnelGatewayArgs) {
    this.manager = args.manager
    this.lifecycle = args.lifecycle
    this.settings = args.settings
    this.store = args.store
    this.broadcast = args.broadcast
    this.now = args.now ?? (() => Date.now())
  }

  async reapOrphanedTunnels(): Promise<void> {
    const chatIds = this.store.listTunnelChats()
    for (const chatId of chatIds) {
      const projection = deriveChatTunnels(this.store.getTunnelEvents(chatId), chatId)
      for (const record of Object.values(projection.tunnels)) {
        if (record.state !== "proposed" && record.state !== "active") continue
        await this.persist({
          v: CLOUDFLARE_TUNNEL_EVENT_VERSION,
          kind: "tunnel_stopped",
          timestamp: this.now(),
          chatId,
          tunnelId: record.tunnelId,
          reason: "server_shutdown",
        })
      }
    }
  }

  async proposeFromTool(args: { chatId: string; port: number; sourcePid?: number | null }): Promise<ProposeOutcome> {
    if (!Number.isInteger(args.port) || args.port < MIN_PORT || args.port > MAX_PORT) {
      return { status: "invalid_port", reason: `port must be an integer in [${MIN_PORT}, ${MAX_PORT}]` }
    }
    const snapshot = this.settings.getSnapshot()
    if (!snapshot.cloudflareTunnel.enabled) {
      return { status: "disabled" }
    }

    const live = this.findLiveTunnelForPort(args.chatId, args.port)
    if (live) {
      return { status: "already_live", tunnelId: live.tunnelId, port: live.port, url: live.url }
    }

    const tunnelId = randomUUID()
    const sourcePid = args.sourcePid ?? null
    this.proposedSourcePid.set(tunnelId, sourcePid)
    await this.persist({
      v: CLOUDFLARE_TUNNEL_EVENT_VERSION,
      kind: "tunnel_proposed",
      timestamp: this.now(),
      chatId: args.chatId,
      tunnelId,
      port: args.port,
      sourcePid,
    })
    return { status: "proposed", tunnelId, port: args.port }
  }

  private findLiveTunnelForPort(chatId: string, port: number): { tunnelId: string; port: number; url: string | null } | null {
    const projection = deriveChatTunnels(this.store.getTunnelEvents(chatId), chatId)
    for (const record of Object.values(projection.tunnels)) {
      if ((record.state === "proposed" || record.state === "active") && record.port === port) {
        return { tunnelId: record.tunnelId, port: record.port, url: record.url }
      }
    }
    return null
  }

  async accept(chatId: string, tunnelId: string): Promise<void> {
    const sourcePid = this.proposedSourcePid.get(tunnelId) ?? null
    const proposedEvents = this.store.getTunnelEvents(chatId).filter((e: CloudflareTunnelEvent) => e.tunnelId === tunnelId)
    const proposed = proposedEvents.find((e: CloudflareTunnelEvent) => e.kind === "tunnel_proposed")
    if (!proposed || proposed.kind !== "tunnel_proposed") return
    await this.persist({
      v: CLOUDFLARE_TUNNEL_EVENT_VERSION,
      kind: "tunnel_accepted",
      timestamp: this.now(),
      chatId,
      tunnelId,
      source: "user",
    })
    await this.manager.start({ chatId, port: proposed.port, sourcePid, tunnelId })
    this.lifecycle.watch(tunnelId, sourcePid)
  }

  async stop(chatId: string, tunnelId: string): Promise<void> {
    this.lifecycle.unwatch(tunnelId)
    const record = deriveChatTunnels(this.store.getTunnelEvents(chatId), chatId).tunnels[tunnelId]
    if (record?.state === "proposed") {
      this.proposedSourcePid.delete(tunnelId)
      await this.persist({
        v: CLOUDFLARE_TUNNEL_EVENT_VERSION,
        kind: "tunnel_stopped",
        timestamp: this.now(),
        chatId,
        tunnelId,
        reason: "user",
      })
      return
    }
    await this.manager.stop(tunnelId, "user")
  }

  async retry(chatId: string, tunnelId: string): Promise<void> {
    await this.accept(chatId, tunnelId)
  }

  closeChat(chatId: string): void {
    const events = this.store.getTunnelEvents(chatId)
    const live = deriveChatTunnels(events, chatId).liveTunnelId
    if (!live) return
    this.lifecycle.unwatch(live)
    void this.manager.stop(live, "session_closed")
  }

  shutdown(): void {
    this.lifecycle.shutdown()
    this.manager.shutdown()
  }

  private async persist(event: CloudflareTunnelEvent): Promise<void> {
    await this.store.appendTunnelEvent(event)
    this.broadcast(event.chatId)
  }
}
