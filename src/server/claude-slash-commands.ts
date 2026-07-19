/**
 * Standalone slash-commands loader helpers for AgentCoordinator.
 *
 * Extracted from agent.ts so the slash-command loading logic lives in its
 * own testable module. The coordinator delegates to these functions by passing
 * an object literal that satisfies `SlashCommandsDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { SlashCommand, Subagent, McpServerConfig, ClaudeDriverPreference } from "../shared/types"
import { resolveClaudeApiModelId } from "../shared/types"
import type { ClaudeSessionHandle, HarnessToolRequest } from "./harness-types"
import type { StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import { log } from "../shared/log"
import { buildKannaSystemPromptAppend } from "../shared/kanna-system-prompt"
import { maskOauthKey } from "../shared/mask-oauth-key"
import { normalizeClaudeModelOptions, normalizeServerModel } from "./provider-catalog"
import type { AnyValue } from "../shared/errors"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by the slash-commands loader. */
interface SlashCommandsStore {
  getChat(id: string):
    | {
        provider: string | null
        slashCommands?: SlashCommand[] | null
        planMode?: boolean | null
        projectId: string
        sessionTokensByProvider: { claude?: string | null }
      }
    | null
    | undefined
  getProject(id: string): { id: string; localPath: string } | null | undefined
  recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]): Promise<void>
}

/** Subset of the active Claude sessions map. */
interface SlashCommandsSessionEntry {
  session: { getSupportedCommands(): Promise<SlashCommand[]> }
}

/** Subset of OAuthTokenPool used by the slash-commands loader. */
interface SlashCommandsOAuthPool {
  pickEphemeral(): { token: { id: string; token: string; label: string }; release(): void } | null
  hasAnyToken(): boolean
  markUsed(id: string): void
}

/** Subset of LocalCatalogService used by mergeLocalCatalog. */
interface SlashCommandsLocalCatalog {
  list(cwd: string): SlashCommand[]
}

/** Minimal SDK session starter (only the args ensureSlashCommandsLoaded passes). */
type SlashCommandsSDKStarter = (args: {
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  oauthToken: string | null
  onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
  systemPromptAppend?: string
  customMcpServers?: readonly McpServerConfig[]
}) => Promise<ClaudeSessionHandle>

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface SlashCommandsDeps {
  store: SlashCommandsStore
  claudeSessions: { get(chatId: string): SlashCommandsSessionEntry | undefined }
  oauthPool: SlashCommandsOAuthPool | null
  /** Mutable set of chatIds whose slash-command fetch is currently in-flight. */
  slashCommandsInFlight: Set<string>
  emitStateChange: (chatId: string) => void
  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  startClaudeSessionPTY: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>
  startClaudeSessionSDK: SlashCommandsSDKStarter
  getSubagents: () => Subagent[]
  getGlobalPromptAppend: () => string | undefined
  getEnabledCustomMcpServers: () => readonly McpServerConfig[]
  claudePtyRegistry:
    | import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry
    | null
    | undefined
  ptyInstanceRegistry:
    | import("./claude-pty/pty-instance-registry").PtyInstanceRegistry
    | null
    | undefined
  workflowRegistry: import("./workflow-registry").WorkflowRegistry | null | undefined
  subagentTranscriptRegistry:
    | import("./subagent-transcript-registry").SubagentTranscriptRegistry
    | null
    | undefined
  localCatalog: SlashCommandsLocalCatalog | null
  /**
   * Hard cap (ms) on the CLI command fetch — the ephemeral spawn and the
   * `getSupportedCommands()` await. Guards against a subprocess whose
   * `system_init` never arrives (the SDK's `supportedCommands()` awaits an
   * initialization promise that then never resolves), which would otherwise
   * pin the chat in `slashCommandsInFlight` forever and leave the `/` picker
   * showing an eternal loading skeleton. Defaults to
   * SLASH_COMMANDS_LOAD_TIMEOUT_MS when omitted.
   */
  timeoutMs?: number
}

/** Default hard cap on the slash-command CLI fetch (spawn + getSupportedCommands). */
export const SLASH_COMMANDS_LOAD_TIMEOUT_MS = 15_000

/**
 * Race `work` against a timeout; reject with a labelled error if the timeout
 * wins. `setTimeout`/`clearTimeout` are host globals (not part of the
 * side-effect seal), so this stays a pure-layer helper.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Load the slash-command catalog for a chat session (no-op if already loaded
 * or a load is in-flight). Spawns an ephemeral Claude session if the chat has
 * no active session, reuses the existing one if it does.
 */
export async function ensureSlashCommandsLoaded(
  deps: SlashCommandsDeps,
  chatId: string,
): Promise<void> {
  const chat = deps.store.getChat(chatId)
  if (!chat) return
  if (chat.provider === "codex") return
  if (chat.slashCommands && chat.slashCommands.length > 0) return
  if (deps.slashCommandsInFlight.has(chatId)) return

  const project = deps.store.getProject(chat.projectId)
  if (!project) return

  const timeoutMs = deps.timeoutMs ?? SLASH_COMMANDS_LOAD_TIMEOUT_MS

  deps.slashCommandsInFlight.add(chatId)
  deps.emitStateChange(chatId)
  try {
    let commands: SlashCommand[]
    const existing = deps.claudeSessions.get(chatId)
    if (existing) {
      commands = await withTimeout(
        existing.session.getSupportedCommands(),
        timeoutMs,
        "getSupportedCommands",
      )
    } else {
      const defaultModel = normalizeServerModel("claude")
      const defaultOptions = normalizeClaudeModelOptions(defaultModel)
      // Ephemeral spawn: reserve under a synthetic key so two concurrent
      // ensureSlashCommandsLoaded calls (different chats) cannot be handed
      // the same token by lastUsedAt ordering. The lease MUST be released
      // once the throwaway session closes (audit #2).
      const lease = deps.oauthPool?.pickEphemeral() ?? null
      // Skip the ephemeral spawn entirely when the pool has tokens but
      // nothing is usable — avoids 401 against the CLI's keychain fallback
      // and an opaque "supportedCommands failed" warning. Slash commands
      // will load on the next turn once a token is available.
      if (deps.oauthPool && deps.oauthPool.hasAnyToken() && !lease) {
        return
      }
      const picked = lease?.token ?? null
      if (picked) deps.oauthPool!.markUsed(picked.id)
      const usePtyEphemeral = deps.resolveClaudeDriverPreference() === "pty"
      const ephemeralSystemPromptAppend = buildKannaSystemPromptAppend(deps.getSubagents(), {
        globalPromptAppend: deps.getGlobalPromptAppend(),
      })
      try {
        const ephemeral = await withTimeout(
          usePtyEphemeral
          ? deps.startClaudeSessionPTY({
              chatId,
              projectId: project.id,
              localPath: project.localPath,
              model: resolveClaudeApiModelId(defaultModel, defaultOptions.contextWindow),
              effort: defaultOptions.reasoningEffort,
              planMode: chat.planMode ?? false,
              sessionToken: chat.sessionTokensByProvider.claude ?? null,
              forkSession: false,
              oauthToken: picked?.token ?? null,
              oauthLabel: picked?.label,
              oauthKeyMasked: picked ? maskOauthKey(picked.token) : undefined,
              onToolRequest: async () => null,
              systemPromptAppend: ephemeralSystemPromptAppend,
              ptyRegistry: deps.claudePtyRegistry ?? undefined,
              ptyInstanceRegistry: deps.ptyInstanceRegistry ?? undefined,
              workflowRegistry: deps.workflowRegistry ?? undefined,
              subagentTranscriptRegistry: deps.subagentTranscriptRegistry ?? undefined,
              customMcpServers: deps.getEnabledCustomMcpServers(),
            })
          : deps.startClaudeSessionSDK({
              projectId: project.id,
              localPath: project.localPath,
              model: resolveClaudeApiModelId(defaultModel, defaultOptions.contextWindow),
              effort: defaultOptions.reasoningEffort,
              planMode: chat.planMode ?? false,
              sessionToken: chat.sessionTokensByProvider.claude ?? null,
              forkSession: false,
              oauthToken: picked?.token ?? null,
              onToolRequest: async () => null,
              systemPromptAppend: ephemeralSystemPromptAppend,
              customMcpServers: deps.getEnabledCustomMcpServers(),
            }),
          timeoutMs,
          "ephemeral claude spawn",
        )
        try {
          commands = await withTimeout(
            ephemeral.getSupportedCommands(),
            timeoutMs,
            "getSupportedCommands",
          )
        } finally {
          ephemeral.close()
        }
      } finally {
        lease?.release()
      }
    }
    const merged = mergeLocalCatalog(deps, commands, project.localPath)
    await deps.store.recordSessionCommandsLoaded(chatId, merged)
    deps.emitStateChange(chatId)
  } catch (error) {
    log.warn("[kanna/agent] ensureSlashCommandsLoaded failed", String(error))
    // Fallback: when the CLI command fetch fails or times out, still surface
    // the local catalog so the picker recovers instead of showing an eternal
    // loading skeleton. Recording nothing when the local catalog is empty
    // keeps the chat retriable on the next subscribe.
    try {
      const localOnly = mergeLocalCatalog(deps, [], project.localPath)
      if (localOnly.length > 0) {
        await deps.store.recordSessionCommandsLoaded(chatId, localOnly)
      }
      deps.emitStateChange(chatId)
    } catch (fallbackError) {
      log.warn("[kanna/agent] ensureSlashCommandsLoaded local fallback failed", String(fallbackError))
    }
  } finally {
    deps.slashCommandsInFlight.delete(chatId)
    deps.emitStateChange(chatId)
  }
}

/**
 * Merge the local command catalog (user/project scans) into the CLI-provided
 * commands list. CLI entries take precedence; local entries with duplicate
 * names (case-insensitive) are filtered out.
 */
export function mergeLocalCatalog(
  deps: Pick<SlashCommandsDeps, "localCatalog">,
  commands: SlashCommand[],
  cwd: string,
): SlashCommand[] {
  if (!deps.localCatalog) return commands
  let local: SlashCommand[]
  try {
    local = deps.localCatalog.list(cwd)
  } catch (error) {
    log.warn("[kanna/agent] localCatalog.list failed", String(error))
    return commands
  }
  const cliKeys = new Set(commands.map((c) => c.name.toLowerCase()))
  const filtered = local.filter((entry) => !cliKeys.has(entry.name.toLowerCase()))
  return [...commands, ...filtered]
}
