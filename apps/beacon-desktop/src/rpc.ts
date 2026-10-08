import type { RPCSchema } from "electrobun/main"
import type { DesktopMessages, DesktopRequests } from "../../../src/beacon/desktop/desktop-types"
import type { DesktopLocale } from "../../../src/beacon/desktop/strings"

export type BeaconDesktopRPC = {
  bun: RPCSchema<{
    requests: DesktopRequests
    messages: { announceLocale: { locale: DesktopLocale } }
  }>
  webview: RPCSchema<{
    requests: Record<string, never>
    messages: DesktopMessages
  }>
}

export const RPC_MAX_REQUEST_MS = 600_000
