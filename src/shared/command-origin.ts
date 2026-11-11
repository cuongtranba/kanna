export interface RemoteMcpOrigin {
  kind: "remote_mcp"
  clientId: string
  clientName?: string
  via: "oauth" | "password"
  tool: string
  callId: string
}

export interface PeerChatOrigin {
  kind: "peer_chat"
  fromChatId: string
  fromTitle: string
  fromProjectId: string
  fromProjectTitle: string
  messageId: string
}

export type CommandOrigin = RemoteMcpOrigin | PeerChatOrigin

export const PASSWORD_CLIENT_ID = "password"

export function remoteMcpVia(clientId: string): RemoteMcpOrigin["via"] {
  return clientId === PASSWORD_CLIENT_ID ? "password" : "oauth"
}

export function isPeerChatOrigin(origin: CommandOrigin | undefined): origin is PeerChatOrigin {
  return origin?.kind === "peer_chat"
}

export function originClientLabel(origin: RemoteMcpOrigin): string {
  const name = origin.clientName?.trim()
  return name ? name : origin.clientId
}

export function originLabel(origin: CommandOrigin): string {
  if (origin.kind === "peer_chat") return `from chat · ${origin.fromTitle}`
  return `via MCP · ${originClientLabel(origin)}`
}

export function originDetail(origin: CommandOrigin): string {
  if (origin.kind === "peer_chat") {
    return `chat ${origin.fromChatId} · project ${origin.fromProjectTitle} · message ${origin.messageId}`
  }
  return `client ${origin.clientId} · tool ${origin.tool} · call ${origin.callId}`
}
