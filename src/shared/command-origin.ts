export interface RemoteMcpOrigin {
  kind: "remote_mcp"
  clientId: string
  clientName?: string
  via: "oauth" | "password"
  tool: string
  callId: string
}

export type CommandOrigin = RemoteMcpOrigin

export const PASSWORD_CLIENT_ID = "password"

export function remoteMcpVia(clientId: string): RemoteMcpOrigin["via"] {
  return clientId === PASSWORD_CLIENT_ID ? "password" : "oauth"
}

export function originClientLabel(origin: CommandOrigin): string {
  const name = origin.clientName?.trim()
  return name ? name : origin.clientId
}

export function originLabel(origin: CommandOrigin): string {
  return `MCP · ${originClientLabel(origin)}`
}

export function originDetail(origin: CommandOrigin): string {
  return `client ${origin.clientId} · tool ${origin.tool} · call ${origin.callId}`
}
