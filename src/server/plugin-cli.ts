/**
 * Pure argv parser for the `kanna plugin <subcommand>` CLI surface. No IO —
 * this only shapes `argv` into a discriminated command the caller can act
 * on, so it does not need the `.adapter.ts` suffix (side-effect seal).
 *
 * Never throws: every unmatched or malformed input resolves to
 * `{ kind: "error" }` with a human-readable `message`, because this backs a
 * CLI entry point that should print a usage message on bad input, not
 * crash the process. Wiring this into `cli-runtime.ts`'s dispatch (deciding
 * exit codes, stdout formatting) is a later chunk — see
 * PROGRESS-plugin-system.md's P7 note.
 */

const DEFAULT_LOGS_TAIL = 100

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
    return { kind: "error", message: "Usage: plugin install <sourceDir>" }
  }
  return { kind: "install", sourceDir }
}

function parseReloadCommand(args: string[]): PluginCliCommand {
  const id = args[0]
  if (!id) {
    return { kind: "error", message: "Usage: plugin reload <id>" }
  }
  return { kind: "reload", id }
}

function parseLogsCommand(args: string[]): PluginCliCommand {
  const id = args[0]
  if (!id) {
    return { kind: "error", message: "Usage: plugin logs <id> [--tail <n>]" }
  }
  const tail = parseTailOption(args.slice(1))
  if (tail === null) {
    return { kind: "error", message: "Invalid --tail value" }
  }
  return { kind: "logs", id, tail }
}

function parseTailOption(args: string[]): number | null {
  const index = args.indexOf("--tail")
  if (index === -1) {
    return DEFAULT_LOGS_TAIL
  }
  const value = args[index + 1]
  if (!value) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}
