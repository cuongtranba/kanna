export const CLOUDFLARE_TUNNEL_EVENT_VERSION = 1 as const

export interface BaseTunnelEvent {
  v: typeof CLOUDFLARE_TUNNEL_EVENT_VERSION
  timestamp: number
  chatId: string
  tunnelId: string
}

export type TunnelStopReason = "user" | "source_exited" | "session_closed" | "server_shutdown"

export type CloudflareTunnelEvent =
  | (BaseTunnelEvent & {
      kind: "tunnel_proposed"
      port: number
      sourcePid: number | null
    })
  | (BaseTunnelEvent & {
      kind: "tunnel_accepted"
      source: "user" | "auto_setting"
    })
  | (BaseTunnelEvent & {
      kind: "tunnel_active"
      url: string
    })
  | (BaseTunnelEvent & {
      kind: "tunnel_stopped"
      reason: TunnelStopReason
    })
  | (BaseTunnelEvent & {
      kind: "tunnel_failed"
      error: string
    })

export function tunnelEnvelope(chatId: string, tunnelId: string, timestamp: number): BaseTunnelEvent {
  return { v: CLOUDFLARE_TUNNEL_EVENT_VERSION, timestamp, chatId, tunnelId }
}
