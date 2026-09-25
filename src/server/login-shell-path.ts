import { positiveIntegerFromEnv } from "./claude-prompt-helpers"

export const LOGIN_SHELL_PATH_RESOLVED_ENV_VAR = "KANNA_LOGIN_SHELL_PATH_RESOLVED"
export const LOGIN_SHELL_RESOLVING_ENV_VAR = "KANNA_RESOLVING_SHELL_ENV"
export const DEFAULT_LOGIN_SHELL_TIMEOUT_MS = 10_000

const PATH_START_MARKER = "__KANNA_LOGIN_SHELL_PATH_START__"
const PATH_END_MARKER = "__KANNA_LOGIN_SHELL_PATH_END__"
const PATH_PROBE_SCRIPT = `printf '%s%s%s' '${PATH_START_MARKER}' "$PATH" '${PATH_END_MARKER}'`

export type ShellEnv = Readonly<Record<string, string | undefined>>

export interface LoginShellRun {
  shell: string
  args: readonly string[]
  env: ShellEnv
  timeoutMs: number
}

export interface LoginShellPathPort {
  platform: string
  env: ShellEnv
  fallbackShell: string | null
  runShell(run: LoginShellRun): Promise<string | null>
}

export type LoginShellPathOutcome =
  | { kind: "merged"; path: string; added: readonly string[]; shell: string }
  | { kind: "skipped"; reason: "disabled" | "already_resolved" | "unsupported_platform" | "no_shell" }
  | { kind: "unavailable"; shell: string }

export function isPathEndMarkerSeen(stdout: string): boolean {
  return stdout.includes(PATH_END_MARKER)
}

function extractLoginShellPath(stdout: string): string | null {
  const start = stdout.lastIndexOf(PATH_START_MARKER)
  if (start === -1) return null
  const valueStart = start + PATH_START_MARKER.length
  const end = stdout.indexOf(PATH_END_MARKER, valueStart)
  if (end === -1) return null
  return stdout.slice(valueStart, end)
}

function splitPath(value: string | undefined): string[] {
  return (value ?? "").split(":").filter((entry) => entry.length > 0)
}

function appendMissingEntries(current: readonly string[], fromShell: readonly string[]): string[] {
  const seen = new Set(current)
  const added: string[] = []
  for (const entry of fromShell) {
    if (seen.has(entry)) continue
    seen.add(entry)
    added.push(entry)
  }
  return added
}

export async function resolveLoginShellPath(port: LoginShellPathPort): Promise<LoginShellPathOutcome> {
  if (port.env.KANNA_LOGIN_SHELL_PATH === "disabled") return { kind: "skipped", reason: "disabled" }
  if (port.env[LOGIN_SHELL_PATH_RESOLVED_ENV_VAR] === "1") return { kind: "skipped", reason: "already_resolved" }
  if (port.platform === "win32") return { kind: "skipped", reason: "unsupported_platform" }
  const shell = port.env.SHELL || port.fallbackShell
  if (!shell) return { kind: "skipped", reason: "no_shell" }

  const stdout = await port.runShell({
    shell,
    args: ["-i", "-l", "-c", PATH_PROBE_SCRIPT],
    env: { ...port.env, [LOGIN_SHELL_RESOLVING_ENV_VAR]: "1" },
    timeoutMs: positiveIntegerFromEnv(port.env.KANNA_LOGIN_SHELL_TIMEOUT_MS, DEFAULT_LOGIN_SHELL_TIMEOUT_MS),
  })
  const shellPath = stdout === null ? null : extractLoginShellPath(stdout)
  if (shellPath === null) return { kind: "unavailable", shell }

  const current = splitPath(port.env.PATH)
  const added = appendMissingEntries(current, splitPath(shellPath))
  return { kind: "merged", path: [...current, ...added].join(":"), added, shell }
}
