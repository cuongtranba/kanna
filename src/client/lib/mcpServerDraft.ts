import { mcpOAuthRedirectUri } from "../../shared/types"
import type {
  McpOAuthPreRegisteredClient,
  McpOAuthState,
  McpServerConfig,
  McpServerInput,
  McpServerTransport,
} from "../../shared/types"

export interface McpServerDraft {
  name: string
  transport: McpServerTransport
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
  oauthClientId: string
  oauthClientSecret: string
  oauthCallbackPort: string
}

export function mcpServerToDraft(config: McpServerConfig | null): McpServerDraft {
  if (config === null) {
    return { name: "", transport: "stdio", command: "", argsText: "", envText: "", cwd: "", url: "", headersText: "", oauthClientId: "", oauthClientSecret: "", oauthCallbackPort: "" }
  }
  if (config.transport === "stdio") {
    return {
      name: config.name,
      transport: "stdio",
      command: config.command,
      argsText: config.args.join("\n"),
      envText: Object.entries(config.env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
      cwd: config.cwd ?? "",
      url: "",
      headersText: "",
      oauthClientId: "",
      oauthClientSecret: "",
      oauthCallbackPort: "",
    }
  }
  return {
    name: config.name,
    transport: config.transport,
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    url: config.url,
    headersText: Object.entries(config.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
    oauthClientId: config.oauth?.preRegisteredClient?.clientId ?? "",
    oauthClientSecret: config.oauth?.preRegisteredClient?.clientSecret ?? "",
    oauthCallbackPort: String(config.oauth?.preRegisteredClient?.callbackPort ?? ""),
  }
}

function parseKeyValueLines(text: string, separator: "=" | ":", trimValue: boolean): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf(separator)
    if (index <= 0) continue
    const value = line.slice(index + 1)
    entries[line.slice(0, index).trim()] = trimValue ? value.trim() : value
  }
  return entries
}

const MAX_PORT = 65535

function parseCallbackPort(text: string): number | undefined {
  const port = Number(text.trim())
  return Number.isInteger(port) && port >= 1 && port <= MAX_PORT ? port : undefined
}

export function mcpPreRegisteredClientFromDraft(draft: McpServerDraft): McpOAuthPreRegisteredClient | undefined {
  const clientId = draft.oauthClientId.trim()
  if (clientId.length === 0) return undefined
  const clientSecret = draft.oauthClientSecret.trim()
  const callbackPort = parseCallbackPort(draft.oauthCallbackPort)
  return {
    clientId,
    ...(clientSecret.length > 0 ? { clientSecret } : {}),
    ...(callbackPort !== undefined ? { callbackPort } : {}),
  }
}

export function mcpOAuthRedirectUriFromDraft(draft: McpServerDraft): string {
  return mcpOAuthRedirectUri(mcpPreRegisteredClientFromDraft(draft))
}

function samePreRegisteredClient(a: McpOAuthPreRegisteredClient | undefined, b: McpOAuthPreRegisteredClient | undefined): boolean {
  return a?.clientId === b?.clientId && a?.clientSecret === b?.clientSecret && a?.callbackPort === b?.callbackPort
}

export function mcpOAuthFromDraft(
  draft: McpServerDraft,
  oauthEnabled: boolean,
  current: McpOAuthState | undefined,
): McpOAuthState | undefined {
  const preRegisteredClient = mcpPreRegisteredClientFromDraft(draft)
  if (current === undefined) {
    return oauthEnabled ? { enabled: true, status: "unauthenticated", preRegisteredClient } : undefined
  }
  if (samePreRegisteredClient(current.preRegisteredClient, preRegisteredClient)) return undefined
  return { ...current, enabled: oauthEnabled, preRegisteredClient }
}

export function mcpServerInputFromDraft(draft: McpServerDraft, oauth?: McpOAuthState): McpServerInput {
  if (draft.transport === "stdio") {
    return {
      name: draft.name,
      transport: "stdio",
      command: draft.command,
      args: draft.argsText
        .split("\n")
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0),
      env: parseKeyValueLines(draft.envText, "=", false),
      cwd: draft.cwd || undefined,
    }
  }
  return {
    name: draft.name,
    transport: draft.transport,
    url: draft.url,
    headers: parseKeyValueLines(draft.headersText, ":", true),
    ...(oauth ? { oauth } : {}),
  }
}
