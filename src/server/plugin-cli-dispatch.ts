
import { CLI_COMMAND } from "../shared/branding"
import { errorMessage } from "../shared/errors"
import type { PluginLogEntry } from "../shared/plugins/log-ring"
import { parsePluginCommand, type PluginCliCommand } from "./plugin-cli"
import type { PluginService, PluginSummary } from "./plugins/plugin-service"
import { getPluginService } from "./plugins/plugin-service-host"

export interface PluginCliOutput {
  log: (message: string) => void
  warn: (message: string) => void
}

type PluginCliAction = Exclude<PluginCliCommand, { kind: "error" }>

export const PLUGIN_CLI_USAGE = [
  "Usage:",
  `  ${CLI_COMMAND} plugin install <sourceDir>`,
  `  ${CLI_COMMAND} plugin ls`,
  `  ${CLI_COMMAND} plugin reload <id>`,
  `  ${CLI_COMMAND} plugin logs <id> [--tail <n>]`,
].join("\n")

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

export function formatPluginTable(plugins: readonly PluginSummary[]): string[] {
  if (plugins.length === 0) return ["No plugins installed."]

  const rows: string[][] = [
    [...PLUGIN_TABLE_HEADER],
    ...plugins.map((plugin) => [plugin.id, plugin.state, plugin.enabled ? "yes" : "no", plugin.sourceDir]),
  ]
  const widths = PLUGIN_TABLE_HEADER.map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  )
  return rows.map((row) =>
    row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join("  "),
  )
}

export function formatPluginLogs(entries: readonly PluginLogEntry[], tail: number): string[] {
  const selected = tail <= 0 ? [] : entries.slice(-tail)
  if (selected.length === 0) return ["No log entries."]
  return selected.map((entry) => `${new Date(entry.at).toISOString()} ${entry.stream} ${entry.text}`)
}
