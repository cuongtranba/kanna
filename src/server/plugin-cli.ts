
import { PLUGIN_LOG_DEFAULT_TAIL } from "../shared/plugins/log-ring"

export const PLUGIN_COMMAND_USAGE = {
  install: "plugin install <sourceDir>",
  ls: "plugin ls",
  reload: "plugin reload <id>",
  logs: "plugin logs <id> [--tail <n>]",
} as const

function usageError(command: keyof typeof PLUGIN_COMMAND_USAGE): PluginCliCommand {
  return { kind: "error", message: `Usage: ${PLUGIN_COMMAND_USAGE[command]}` }
}

export type PluginCliCommand =
  | { kind: "install"; sourceDir: string }
  | { kind: "ls" }
  | { kind: "reload"; id: string }
  | { kind: "logs"; id: string; tail: number }
  | { kind: "error"; message: string }

export function parsePluginCommand(argv: string[]): PluginCliCommand {
  const [subcommand, ...rest] = argv
  switch (subcommand) {
    case "install":
      return parseInstallCommand(rest)
    case "ls":
      return { kind: "ls" }
    case "reload":
      return parseReloadCommand(rest)
    case "logs":
      return parseLogsCommand(rest)
    default:
      return {
        kind: "error",
        message: subcommand
          ? `Unknown plugin subcommand: ${subcommand}`
          : "Missing plugin subcommand",
      }
  }
}

function parseInstallCommand(args: string[]): PluginCliCommand {
  const sourceDir = args[0]
  if (!sourceDir) {
    return usageError("install")
  }
  return { kind: "install", sourceDir }
}

function parseReloadCommand(args: string[]): PluginCliCommand {
  const id = args[0]
  if (!id) {
    return usageError("reload")
  }
  return { kind: "reload", id }
}

function parseLogsCommand(args: string[]): PluginCliCommand {
  const id = args[0]
  if (!id) {
    return usageError("logs")
  }
  const tail = parseTailOption(args.slice(1))
  if (tail === null) {
    return { kind: "error", message: "Invalid --tail value" }
  }
  return { kind: "logs", id, tail }
}

function parseTailOption(args: string[]): number | null {
  const index = args.indexOf("--tail")
  return parseLogTail(index === -1 ? undefined : (args[index + 1] ?? ""))
}

export function parseLogTail(raw: string | undefined): number | null {
  if (raw === undefined) return PLUGIN_LOG_DEFAULT_TAIL
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}
