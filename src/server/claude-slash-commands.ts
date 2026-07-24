/**
 * Standalone slash-commands loader helpers for AgentCoordinator.
 *
 * The `/` composer picker is populated **exclusively** from the local,
 * disk-scanned catalog (project `<cwd>/.claude` + personal `~/.claude`). It does
 * NOT spawn the Claude Code CLI to read built-in commands: cold-spawning the
 * ~265 MB `claude` binary just to call `getSupportedCommands()` used to block
 * the picker on an empty loading skeleton (up to a hard timeout) — worst on
 * WSL2 / CLI ≥2.1.x where `system_init` never arrives. The local catalog is
 * available instantly, so the picker can never hang.
 *
 * Plugin-scope entries (`~/.claude/plugins/**`) are intentionally excluded —
 * only project + personal (user) scopes are surfaced.
 *
 * Side-effect seal: this module contains NO direct IO. Every effectful
 * operation is injected through the deps interface.
 */

import type { SlashCommand } from "../shared/types"
import { log } from "../shared/log"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by the slash-commands loader. */
interface SlashCommandsStore {
  getChat(id: string):
    | {
        provider: string | null
        slashCommands?: SlashCommand[] | null
        projectId: string
      }
    | null
    | undefined
  getProject(id: string): { id: string; localPath: string } | null | undefined
  recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]): Promise<void>
}

/** Subset of LocalCatalogService used by localCommandsForCwd. */
interface SlashCommandsLocalCatalog {
  list(cwd: string): SlashCommand[]
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface SlashCommandsDeps {
  store: SlashCommandsStore
  /** Mutable set of chatIds whose slash-command load is currently in-flight. */
  slashCommandsInFlight: Set<string>
  emitStateChange: (chatId: string) => void
  localCatalog: SlashCommandsLocalCatalog | null
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Load the slash-command catalog for a chat session from the local disk-scanned
 * catalog only (no-op if already loaded or a load is in-flight). No CLI spawn:
 * the catalog is read synchronously from `LocalCatalogService`, so this resolves
 * immediately and the picker never shows an eternal loading skeleton.
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

  deps.slashCommandsInFlight.add(chatId)
  deps.emitStateChange(chatId)
  try {
    const commands = localCommandsForCwd(deps, project.localPath)
    await deps.store.recordSessionCommandsLoaded(chatId, commands)
    deps.emitStateChange(chatId)
    log.info("[kanna/agent] ensureSlashCommandsLoaded loaded", {
      chatId,
      commandCount: commands.length,
    })
  } catch (error) {
    log.warn("[kanna/agent] ensureSlashCommandsLoaded failed", {
      chatId,
      error: String(error),
    })
  } finally {
    deps.slashCommandsInFlight.delete(chatId)
    deps.emitStateChange(chatId)
  }
}

/**
 * The local command catalog for a cwd, restricted to project + personal (user)
 * scopes. Plugin-scope entries and CLI built-ins are excluded. A scan failure
 * degrades to an empty list (logged) rather than throwing.
 */
export function localCommandsForCwd(
  deps: Pick<SlashCommandsDeps, "localCatalog">,
  cwd: string,
): SlashCommand[] {
  if (!deps.localCatalog) return []
  let local: SlashCommand[]
  try {
    local = deps.localCatalog.list(cwd)
  } catch (error) {
    log.warn("[kanna/agent] localCatalog.list failed", String(error))
    return []
  }
  return local.filter((entry) => entry.scope === "project" || entry.scope === "personal")
}
