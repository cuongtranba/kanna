/**
 * The composer `/` picker's command catalog.
 *
 * The picker is populated **exclusively** from the local, disk-scanned catalog
 * (project `<cwd>/.claude`, personal `~/.claude`, and the skills of *enabled*
 * plugins). It does NOT spawn the Claude Code CLI to read built-in commands:
 * cold-spawning the ~265 MB `claude` binary just to call
 * `getSupportedCommands()` used to block the picker on an empty loading
 * skeleton (up to a hard timeout) — worst on WSL2 / CLI ≥2.1.x where
 * `system_init` never arrives.
 *
 * The catalog is a property of the project's **cwd**, not of a chat, and is
 * served through the `project-commands` subscription topic. It is read
 * synchronously here, so there is no async load, no in-flight state, and
 * nothing for the picker to wait on.
 *
 * Side-effect seal: this module contains NO direct IO. Every effectful
 * operation is injected through the deps interface.
 */

import type { SlashCommand } from "../shared/types"
import { BUILTIN_SLASH_COMMANDS } from "../shared/builtin-commands"
import { log } from "../shared/log"

/** Subset of LocalCatalogService used by localCommandsForCwd. */
interface SlashCommandsLocalCatalog {
  list(cwd: string): SlashCommand[]
}

export interface SlashCommandsDeps {
  localCatalog: SlashCommandsLocalCatalog | null
}

/**
 * The command catalog for a cwd: Kanna's own builtins, then every entry the
 * scanner found across project, personal, and plugin scopes. The scanner
 * already restricts plugin scope to *enabled* plugins, so filtering here would
 * only hide commands the SDK would happily accept. A scan failure degrades to
 * the builtins alone (logged) rather than throwing.
 *
 * The merge lives here rather than in `LocalCatalogService`: that service's
 * contract is the disk catalog, and the builtins are a static constant that
 * never touches disk. Prepending makes them the picker's floor. A project that
 * defines its own `clear` command is dropped from the listing because the
 * builtin intercepts that name at dispatch — offering it twice would promise
 * behaviour Kanna will not deliver.
 */
export function localCommandsForCwd(
  deps: Pick<SlashCommandsDeps, "localCatalog">,
  cwd: string,
): SlashCommand[] {
  const builtins = [...BUILTIN_SLASH_COMMANDS]
  if (!deps.localCatalog) return builtins
  try {
    const builtinNames = new Set(builtins.map((command) => command.name.toLowerCase()))
    const disk = deps.localCatalog
      .list(cwd)
      .filter((command) => !builtinNames.has(command.name.toLowerCase()))
    return [...builtins, ...disk]
  } catch (error) {
    log.warn("[kanna/agent] localCatalog.list failed", String(error))
    return builtins
  }
}
