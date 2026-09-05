
import type { ClaudeDriverPreference, McpServerConfig, McpOAuthState } from "../shared/types"
import type { ChatPermissionPolicy, ChatPermissionPolicyOverride } from "../shared/permission-policy"
import { mergePolicyOverride } from "../shared/permission-policy"
import { log } from "../shared/log"


interface AppSettingsLike {
  claudeDriver?: { preference?: ClaudeDriverPreference }
  customMcpServers?: readonly McpServerConfig[]
}

interface ChatLike {
  policyOverride?: ChatPermissionPolicyOverride | null
}

interface ChatsByIdLike {
  get(chatId: string): ChatLike | undefined
}

interface StoreLike {
  state?: { chatsById?: ChatsByIdLike } | null
}

interface PtyInstanceRegistryLike {
  snapshot(): ReadonlyArray<{ chatId: string; pid: number | null }>
  markExitedIfCurrent(
    chatId: string,
    pid: number,
    patch: { phase: "exited"; exitedAt: number; lastEventAt: number },
  ): void
}


export interface ClaudeSessionConfigHelpersDeps {
  getAppSettingsSnapshot: () => AppSettingsLike
  chatPolicy: ChatPermissionPolicy
  store: StoreLike
  ptyInstanceRegistry: PtyInstanceRegistryLike | null
  ensureFreshToken: (
    server: McpServerConfig,
    opts: { persist: (oauth: McpOAuthState) => void },
  ) => Promise<string>
  persistOAuthState: ((id: string, oauth: McpOAuthState) => void) | null
  killProcessTree: (pid: number) => Promise<void>
}


export function resolveClaudeDriverPreference(
  deps: ClaudeSessionConfigHelpersDeps,
): ClaudeDriverPreference {
  const fromSettings = deps.getAppSettingsSnapshot().claudeDriver?.preference
  if (fromSettings === "pty" || fromSettings === "sdk") return fromSettings
  return process.env.KANNA_CLAUDE_DRIVER === "pty" ? "pty" : "sdk"
}

export function getEnabledCustomMcpServers(
  deps: ClaudeSessionConfigHelpersDeps,
): readonly McpServerConfig[] {
  const snap = deps.getAppSettingsSnapshot()
  const list = snap.customMcpServers
  if (!Array.isArray(list)) return []
  return list.filter((s) => s.enabled)
}

export async function buildOAuthBearers(
  deps: ClaudeSessionConfigHelpersDeps,
  servers: readonly McpServerConfig[],
): Promise<Map<string, string>> {
  const bearers = new Map<string, string>()
  for (const s of servers) {
    if (s.transport === "stdio" || !s.oauth || s.oauth.status !== "authenticated") continue
    try {
      const token = await deps.ensureFreshToken(s, {
        persist: (oauth) => {
          if (deps.persistOAuthState) deps.persistOAuthState(s.id, oauth)
        },
      })
      bearers.set(s.id, token)
    } catch (err) {
      log.warn("[kanna/mcp-oauth] token refresh failed for", s.name, String(err))
    }
  }
  return bearers
}

export function resolveChatPolicy(
  deps: ClaudeSessionConfigHelpersDeps,
  chatId: string,
): ChatPermissionPolicy {
  const override = deps.store.state?.chatsById?.get(chatId)?.policyOverride ?? null
  return mergePolicyOverride(deps.chatPolicy, override)
}

export async function killPtyInstance(
  deps: ClaudeSessionConfigHelpersDeps,
  chatId: string,
): Promise<void> {
  const instance = deps.ptyInstanceRegistry?.snapshot().find((entry) => entry.chatId === chatId)
  if (!instance || instance.pid === null) {
    throw new Error("No live PTY instance for chat")
  }
  await deps.killProcessTree(instance.pid)
  deps.ptyInstanceRegistry?.markExitedIfCurrent(chatId, instance.pid, {
    phase: "exited",
    exitedAt: Date.now(),
    lastEventAt: Date.now(),
  })
}
