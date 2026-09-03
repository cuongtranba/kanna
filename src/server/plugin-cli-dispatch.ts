/**
 * Dispatch half of the `kanna plugin <subcommand>` CLI surface: turns a
 * `PluginCliCommand` (parsed by the pure `plugin-cli.ts`) into `PluginService`
 * calls, rendered stdout lines, and a process exit code.
 *
 * It lives beside `plugin-cli.ts` rather than inside `cli-runtime.ts` for two
 * reasons. `cli-runtime.ts` is the flag/bootstrap module and is already the
 * largest thing on the CLI path (`MODULE_LINE_THRESHOLD` is 700 and it is
 * unlisted in the architecture budget); and the formatting here — the `ls`
 * table, the log rendering — is worth testing directly, which needs it to be
 * importable without dragging in the server bootstrap. `cli-runtime.ts` keeps
 * only the one-line arm that routes into `runPluginCli`.
 *
 * No IO: every write goes through the injected `PluginCliOutput`, and the
 * service is a parameter defaulting to the process-wide instance, so a test
 * never spawns a plugin child or touches the real `~/.kanna/plugins`.
 */

import { CLI_COMMAND } from "../shared/branding"
import { errorMessage } from "../shared/errors"
import type { PluginLogEntry } from "../shared/plugins/log-ring"
import { parsePluginCommand, type PluginCliCommand } from "./plugin-cli"
import type { PluginService, PluginSummary } from "./plugins/plugin-service"
import { getPluginService } from "./plugins/plugin-service-host"

/**
 * Where rendered lines go. `cli-runtime.ts` passes its own `log`/`warn`
 * callbacks straight through, which is how this module honours the repo-wide
 * `no-console` seal without knowing about `src/shared/log.ts` at all.
 */
export interface PluginCliOutput {
  log: (message: string) => void
  warn: (message: string) => void
}

/** Every command `parsePluginCommand` can produce EXCEPT the parse failure. */
type PluginCliAction = Exclude<PluginCliCommand, { kind: "error" }>

export const PLUGIN_CLI_USAGE = [
  "Usage:",
  `  ${CLI_COMMAND} plugin install <sourceDir>`,
  `  ${CLI_COMMAND} plugin ls`,
  `  ${CLI_COMMAND} plugin reload <id>`,
  `  ${CLI_COMMAND} plugin logs <id> [--tail <n>]`,
].join("\n")

/**
 * Run one `plugin` subcommand. Returns the process exit code: 0 on success,
 * 1 on a parse error or a thrown service error. Never throws, and never
 * prints a stack — a `PluginService` failure surfaces as its `message` only.
 */
export async function runPluginCli(
  argv: string[],
  out: PluginCliOutput,
  service: PluginService = getPluginService(),
): Promise<number> {
  const command = parsePluginCommand(argv)
  if (command.kind === "error") {
    out.warn(command.message)
    out.warn(PLUGIN_CLI_USAGE)
    return 1
  }

  try {
    await dispatchPluginCommand(command, out, service)
    return 0
  } catch (error) {
    out.warn(`plugin ${command.kind} failed: ${errorMessage(error)}`)
    return 1
  }
}

async function dispatchPluginCommand(
  command: PluginCliAction,
  out: PluginCliOutput,
  service: PluginService,
): Promise<void> {
  switch (command.kind) {
    case "install": {
      const before = service.list()
      await service.install({ sourceDir: command.sourceDir })
      out.log(formatInstalled(before, service.list(), command.sourceDir))
      return
    }
    case "ls": {
      for (const line of formatPluginTable(service.list())) out.log(line)
      return
    }
    case "reload": {
      await service.reload(command.id)
      out.log(`reloaded ${command.id}`)
      return
    }
    case "logs": {
      for (const line of formatPluginLogs(service.logs(command.id), command.tail)) out.log(line)
    }
  }
}

/**
 * `PluginService.install` resolves to `void` — the id comes from the manifest
 * it just read, and only the registry knows it. Recover it by diffing `list()`
 * around the call: a first install adds an id, and a REINSTALL adds none, so
 * fall back to the existing row for the same source directory before giving up
 * and naming the directory.
 */
export function formatInstalled(
  before: readonly PluginSummary[],
  after: readonly PluginSummary[],
  sourceDir: string,
): string {
  const beforeIds = new Set(before.map((plugin) => plugin.id))
  const fromSource = after.filter((plugin) => plugin.sourceDir === sourceDir)
  const installed = fromSource.find((plugin) => !beforeIds.has(plugin.id)) ?? fromSource[0]
  return installed ? `installed ${installed.id}` : `installed plugin from ${sourceDir}`
}

const PLUGIN_TABLE_HEADER = ["ID", "STATE", "ENABLED", "SOURCE"] as const

/** `ls` output: a padded table, or one explanatory line when nothing is installed. */
export function formatPluginTable(plugins: readonly PluginSummary[]): string[] {
  if (plugins.length === 0) return ["No plugins installed."]

  const rows: string[][] = [
    [...PLUGIN_TABLE_HEADER],
    ...plugins.map((plugin) => [plugin.id, plugin.state, plugin.enabled ? "yes" : "no", plugin.sourceDir]),
  ]
  const widths = PLUGIN_TABLE_HEADER.map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  )
  // The last column is never padded — a trailing run of spaces after the
  // source path is invisible noise that breaks `diff` on captured output.
  return rows.map((row) =>
    row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join("  "),
  )
}

/** `logs` output: the newest `tail` entries, oldest first. */
export function formatPluginLogs(entries: readonly PluginLogEntry[], tail: number): string[] {
  // `slice(-0)` is `slice(0)` — the whole array — so `--tail 0` needs its own
  // branch rather than falling through to the slice.
  const selected = tail <= 0 ? [] : entries.slice(-tail)
  if (selected.length === 0) return ["No log entries."]
  return selected.map((entry) => `${new Date(entry.at).toISOString()} ${entry.stream} ${entry.text}`)
}
