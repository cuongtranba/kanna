import { oneOf } from "../vocab"

export const PEER_INBOUND_MODES = ["accept", "refuse"] as const

export type PeerInboundMode = (typeof PEER_INBOUND_MODES)[number]

export const DEFAULT_PEER_INBOUND_MODE: PeerInboundMode = "accept"

const isPeerInboundMode = oneOf(PEER_INBOUND_MODES)

export function normalizePeerInbound<T>(value: T): PeerInboundMode {
  return isPeerInboundMode(value) ? value : DEFAULT_PEER_INBOUND_MODE
}

export function resolvePeerInbound(
  chatOverride: PeerInboundMode | null | undefined,
  globalMode: PeerInboundMode,
): PeerInboundMode {
  return chatOverride ?? globalMode
}
