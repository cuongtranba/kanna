import { randomUUID } from "node:crypto"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import type { CloudflareTunnelEvent } from "./events"
import { tunnelEnvelope } from "./events"
import { TunnelLifecycle } from "./lifecycle"
import { deriveChatTunnels, isLiveTunnel } from "./read-model"
import { TunnelManager } from "./tunnel-manager.adapter"

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
  | { status: "auto_exposed"; tunnelId: string; port: number }
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
        if (!isLiveTunnel(record)) continue
        await this.persist({
          ...tunnelEnvelope(chatId, record.tunnelId, this.now()),
          kind: "tunnel_stopped",
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
    await this.persist({
      ...tunnelEnvelope(args.chatId, tunnelId, this.now()),
      kind: "tunnel_proposed",
      port: args.port,
      sourcePid,
    })

    if (snapshot.cloudflareTunnel.mode === "auto-expose") {
      await this.persist({
        ...tunnelEnvelope(args.chatId, tunnelId, this.now()),
        kind: "tunnel_accepted",
        source: "auto_setting",
      })
      await this.manager.start({ chatId: args.chatId, port: args.port, sourcePid, tunnelId })
      this.lifecycle.watch(tunnelId, sourcePid)
      return { status: "auto_exposed", tunnelId, port: args.port }
    }

    return { status: "proposed", tunnelId, port: args.port }
  }

  private findLiveTunnelForPort(chatId: string, port: number): { tunnelId: string; port: number; url: string | null } | null {
    const projection = deriveChatTunnels(this.store.getTunnelEvents(chatId), chatId)
    for (const record of Object.values(projection.tunnels)) {
      if (isLiveTunnel(record) && record.port === port) {
        return { tunnelId: record.tunnelId, port: record.port, url: record.url }
      }
    }
    return null
  }

  async accept(chatId: string, tunnelId: string): Promise<void> {
    const proposedEvents = this.store.getTunnelEvents(chatId).filter((e: CloudflareTunnelEvent) => e.tunnelId === tunnelId)
    const proposed = proposedEvents.find((e: CloudflareTunnelEvent) => e.kind === "tunnel_proposed")
    if (!proposed || proposed.kind !== "tunnel_proposed") return
    await this.persist({
      ...tunnelEnvelope(chatId, tunnelId, this.now()),
      kind: "tunnel_accepted",
      source: "user",
    })
    await this.manager.start({ chatId, port: proposed.port, sourcePid: proposed.sourcePid, tunnelId })
    this.lifecycle.watch(tunnelId, proposed.sourcePid)
  }

  async stop(chatId: string, tunnelId: string): Promise<void> {
    this.lifecycle.unwatch(tunnelId)
    const record = deriveChatTunnels(this.store.getTunnelEvents(chatId), chatId).tunnels[tunnelId]
    if (record?.state === "proposed") {
      await this.persist({
        ...tunnelEnvelope(chatId, tunnelId, this.now()),
        kind: "tunnel_stopped",
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
