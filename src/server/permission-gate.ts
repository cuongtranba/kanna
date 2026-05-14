import type {
  ChatPermissionPolicy,
  PolicyVerdict,
} from "../shared/permission-policy"
import { parse as shellParse } from "shell-quote"
import path from "node:path"
import { homedir } from "node:os"
import { minimatch } from "minimatch"

export interface EvaluateArgs {
  toolName: string
  args: Record<string, unknown>
  chatPolicy: ChatPermissionPolicy
  cwd: string
}

export interface EvaluateResult {
  verdict: PolicyVerdict
  reason?: string
}

function argsToText(args: Record<string, unknown>): string {
  return typeof args.command === "string" ? args.command : JSON.stringify(args)
}

interface ShellOp { op: string }
function isShellOp(token: unknown): token is ShellOp {
  return typeof token === "object" && token !== null && "op" in (token as object)
}

interface ParsedSimpleCommand {
  verb: string
  paths: string[]
  hadEnvPrefix: boolean
}

function parseSimpleBash(
  command: string,
  cwd: string,
  autoAllowVerbs: string[],
): ParsedSimpleCommand | null {
  const tokens = shellParse(command)
  for (const t of tokens) {
    if (isShellOp(t)) return null  // pipe/redirect/subshell/glob/etc.
  }
  const stringTokens = tokens as string[]
  if (stringTokens.length === 0) return null

  let hadEnvPrefix = false
  let i = 0
  while (i < stringTokens.length && /^[A-Z_][A-Z0-9_]*=/.test(stringTokens[i])) {
    hadEnvPrefix = true
    i++
  }
  const rest = stringTokens.slice(i)
  if (rest.length === 0) return null

  let verb: string | null = null
  let argsStart = 1
  const sorted = [...autoAllowVerbs].sort((a, b) => b.length - a.length)
  for (const candidate of sorted) {
    const parts = candidate.split(/\s+/)
    if (rest.length >= parts.length && parts.every((p, idx) => rest[idx] === p)) {
      verb = candidate
      argsStart = parts.length
      break
    }
  }
  if (!verb) {
    verb = rest[0]
    argsStart = 1
  }

  const paths: string[] = []
  for (const arg of rest.slice(argsStart)) {
    const isPathLike = arg.startsWith("~") || arg.includes("/") || arg.startsWith(".")
    if (!isPathLike) continue
    const expanded = arg.startsWith("~")
      ? path.join(homedir(), arg.slice(1).replace(/^\//, ""))
      : arg
    const resolved = path.resolve(cwd, expanded)
    paths.push(resolved)
  }
  return { verb, paths, hadEnvPrefix }
}

function pathMatchesDeny(absPath: string, deny: string[]): string | null {
  for (const pattern of deny) {
    const expanded = pattern.startsWith("~")
      ? path.join(homedir(), pattern.slice(1).replace(/^\//, ""))
      : pattern
    const matchPattern = expanded.endsWith("/**") || expanded.includes("*")
      ? expanded
      : `${expanded}/**`
    if (minimatch(absPath, matchPattern, { dot: true }) || absPath === expanded) {
      return pattern
    }
  }
  return null
}

export const policy = {
  evaluate(args: EvaluateArgs): EvaluateResult {
    // Bash-specific arg parsing.
    if (args.toolName === "mcp__kanna__bash") {
      const command = typeof args.args.command === "string" ? args.args.command : ""
      const parsed = parseSimpleBash(command, args.cwd, args.chatPolicy.bash.autoAllowVerbs)
      if (!parsed) {
        return { verdict: "ask", reason: "bash command uses shell features" }
      }
      if (parsed.hadEnvPrefix) {
        return { verdict: "ask", reason: "bash command has env prefix" }
      }
      for (const p of parsed.paths) {
        const denied = pathMatchesDeny(p, args.chatPolicy.readPathDeny)
        if (denied) {
          return { verdict: "auto-deny", reason: `readPathDeny: ${denied}` }
        }
      }
    }

    // 1. Deny list wins over everything.
    for (const rule of args.chatPolicy.toolDenyList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-deny", reason: `matched denylist: ${rule.pattern}` }
      }
    }

    // 2. Bash auto-allow if verb is in autoAllowVerbs and no deny path
    if (args.toolName === "mcp__kanna__bash") {
      const command = typeof args.args.command === "string" ? args.args.command : ""
      const parsed = parseSimpleBash(command, args.cwd, args.chatPolicy.bash.autoAllowVerbs)
      if (parsed && args.chatPolicy.bash.autoAllowVerbs.includes(parsed.verb)) {
        return { verdict: "auto-allow", reason: `verb in autoAllowVerbs: ${parsed.verb}` }
      }
      return { verdict: "ask", reason: "bash verb not on autoAllowVerbs" }
    }

    // 3. Allow list
    for (const rule of args.chatPolicy.toolAllowList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-allow", reason: `matched allowlist: ${rule.pattern}` }
      }
    }

    // 4. Default action.
    return { verdict: args.chatPolicy.defaultAction === "ask" ? "ask" : args.chatPolicy.defaultAction }
  },
}
