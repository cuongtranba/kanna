
import type { McpServerConfig, McpOAuthState } from "../shared/types"
import type { ChatPermissionPolicy, ChatPermissionPolicyOverride } from "../shared/permission-policy"
import { mergePolicyOverride } from "../shared/permission-policy"
import { log } from "../shared/log"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { bearerUsableUntil } from "./mcp-oauth.adapter"


interface AppSettingsLike {
  customMcpServers?: readonly McpServerConfig[]
}

interface ChatLike {
  policyOverride?: ChatPermissionPolicyOverride | null
}

interface StoreLike {
  getChat(chatId: string): ChatLike | null
}

export interface ClaudeSessionConfigHelpersDeps {
  getAppSettingsSnapshot: () => AppSettingsLike
  chatPolicy: ChatPermissionPolicy
  store: StoreLike
  ensureFreshToken: (
    server: McpServerConfig,
    opts: { persist: (oauth: McpOAuthState) => void },
  ) => Promise<string>
  persistOAuthState: ((id: string, oauth: McpOAuthState) => void) | null
}


export function getEnabledCustomMcpServers(
  deps: Pick<ClaudeSessionConfigHelpersDeps, "getAppSettingsSnapshot">,
): readonly McpServerConfig[] {
  return (deps.getAppSettingsSnapshot().customMcpServers ?? [])
    .filter((s) => s.enabled && s.name !== KANNA_MCP_SERVER_NAME)
}

export interface OAuthBearers {
  byServerId: ReadonlyMap<string, string>
  usableUntil: number | null
}

function earlierDeadline(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

export async function buildOAuthBearers(
  deps: Pick<ClaudeSessionConfigHelpersDeps, "ensureFreshToken" | "persistOAuthState">,
  servers: readonly McpServerConfig[],
): Promise<OAuthBearers> {
  const byServerId = new Map<string, string>()
  let usableUntil: number | null = null
  for (const s of servers) {
    if (s.transport === "stdio" || !s.oauth || s.oauth.status !== "authenticated") continue
    let current: McpOAuthState = s.oauth
    try {
      const token = await deps.ensureFreshToken(s, {
        persist: (oauth) => {
          current = oauth
          if (deps.persistOAuthState) deps.persistOAuthState(s.id, oauth)
        },
      })
      byServerId.set(s.id, token)
      usableUntil = earlierDeadline(usableUntil, bearerUsableUntil(current))
    } catch (err) {
      log.warn("[kanna/mcp-oauth] token refresh failed for", s.name, String(err))
    }
  }
  return { byServerId, usableUntil }
}

export interface CustomMcpServerGrant {
  servers: readonly McpServerConfig[]
  usableUntil: number | null
}

export type ResolveCustomMcpServers = () => Promise<CustomMcpServerGrant>

function withBearer(server: McpServerConfig, bearers: ReadonlyMap<string, string>): McpServerConfig {
  const bearer = bearers.get(server.id)
  if (server.transport === "stdio" || !bearer) return server
  return { ...server, headers: { ...server.headers, Authorization: `Bearer ${bearer}` } }
}

export function createCustomMcpServerResolver(
  deps: Pick<ClaudeSessionConfigHelpersDeps, "getAppSettingsSnapshot" | "ensureFreshToken" | "persistOAuthState">,
): ResolveCustomMcpServers {
  return async () => {
    const enabled = getEnabledCustomMcpServers(deps)
    const { byServerId, usableUntil } = await buildOAuthBearers(deps, enabled)
    return { servers: enabled.map((server) => withBearer(server, byServerId)), usableUntil }
  }
}

export function resolveChatPolicy(
  deps: ClaudeSessionConfigHelpersDeps,
  chatId: string,
): ChatPermissionPolicy {
  const override = deps.store.getChat(chatId)?.policyOverride ?? null
  return mergePolicyOverride(deps.chatPolicy, override)
}
