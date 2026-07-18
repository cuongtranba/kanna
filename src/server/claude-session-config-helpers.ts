/**
 * Standalone helpers for resolving Claude session configuration:
 * driver preference, custom MCP servers, OAuth bearers, chat policy, and PTY teardown.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP calls,
 * no Bun primitives, no adapter imports). Every effectful operation is injected
 * through the deps interface.
 *
 * Extracted from agent.ts to keep that file under the 600-LOC target.
 */

import type { ClaudeDriverPreference, McpServerConfig, McpOAuthState } from "../shared/types"
import type { ChatPermissionPolicy, ChatPermissionPolicyOverride } from "../shared/permission-policy"
import { mergePolicyOverride } from "../shared/permission-policy"
import { log } from "../shared/log"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the slices this module calls.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public deps interface
// ---------------------------------------------------------------------------

export interface ClaudeSessionConfigHelpersDeps {
  getAppSettingsSnapshot: () => AppSettingsLike
  chatPolicy: ChatPermissionPolicy
  store: StoreLike
  ptyInstanceRegistry: PtyInstanceRegistryLike | null
  /** Injected so this module does not import the MCP OAuth adapter directly. */
  ensureFreshToken: (
    server: McpServerConfig,
    opts: { persist: (oauth: McpOAuthState) => void },
  ) => Promise<string>
  persistOAuthState: ((id: string, oauth: McpOAuthState) => void) | null
  /** Injected so this module does not import the PTY PID registry adapter directly. */
  killProcessTree: (pid: number) => Promise<void>
}

// ---------------------------------------------------------------------------
// Standalone functions
// ---------------------------------------------------------------------------

/**
 * Resolves the effective Claude driver preference: settings overlay over
 * the `KANNA_CLAUDE_DRIVER` env var, defaulting to "sdk".
 */
export function resolveClaudeDriverPreference(
  deps: ClaudeSessionConfigHelpersDeps,
): ClaudeDriverPreference {
  const fromSettings = deps.getAppSettingsSnapshot().claudeDriver?.preference
  if (fromSettings === "pty" || fromSettings === "sdk") return fromSettings
  return process.env.KANNA_CLAUDE_DRIVER === "pty" ? "pty" : "sdk"
}

/**
 * Returns the list of enabled custom MCP servers from the app settings snapshot.
 */
export function getEnabledCustomMcpServers(
  deps: ClaudeSessionConfigHelpersDeps,
): readonly McpServerConfig[] {
  const snap = deps.getAppSettingsSnapshot()
  const list = snap.customMcpServers
  if (!Array.isArray(list)) return []
  return list.filter((s) => s.enabled)
}

/**
 * Builds a map of MCP server id → OAuth bearer token for all enabled,
 * authenticated, non-stdio servers. Tokens are refreshed if near expiry.
 */
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

/**
 * Resolves the effective ChatPermissionPolicy for a chat: starts from the
 * coordinator-wide default, overlays the chat's persisted policyOverride.
 */
export function resolveChatPolicy(
  deps: ClaudeSessionConfigHelpersDeps,
  chatId: string,
): ChatPermissionPolicy {
  // store.state may be absent in test fakes that don't implement the full
  // EventStore — fall through to the global default policy in that case.
  const override = deps.store.state?.chatsById?.get(chatId)?.policyOverride ?? null
  return mergePolicyOverride(deps.chatPolicy, override)
}

/**
 * Kills the PTY process (and its process tree) for the given chat.
 * Marks the PTY instance as exited in the registry after the kill.
 */
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
