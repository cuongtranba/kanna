import type {
  ChatPermissionPolicy,
  PolicyVerdict,
} from "../shared/permission-policy"
import { parse as shellParse } from "shell-quote"
import path from "node:path"
import { homedir } from "node:os"
import { minimatch } from "minimatch"
import { log } from "../shared/log"
import { isRecord } from "../shared/errors"
import type { JsonObject } from "../shared/json"

export interface EvaluateArgs {
  toolName: string
  args: JsonObject
  chatPolicy: ChatPermissionPolicy
  cwd: string
  restrictedAllowedPaths?: readonly string[]
}

export function pathInsideAllowedRoots(absPath: string, roots: readonly string[]): boolean {
  for (const root of roots) {
    if (absPath === root) return true
    const rel = path.relative(root, absPath)
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return true
  }
  return false
}

export interface EvaluateResult {
  verdict: PolicyVerdict
  reason?: string
}

function argsToText(args: JsonObject): string {
  return typeof args.command === "string" ? args.command : JSON.stringify(args)
}

interface ShellOp { op: string }
function isShellOp<T>(token: T): token is T & ShellOp {
  return isRecord(token) && typeof token.op === "string"
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
    if (isShellOp(t)) return null
  }
  const stringTokens = tokens.filter((t): t is string => typeof t === "string")
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

const READ_PATH_TOOLS = new Set([
  "mcp__kanna__read",
  "mcp__kanna__glob",
  "mcp__kanna__grep",
])
const WRITE_PATH_TOOLS = new Set([
  "mcp__kanna__write",
  "mcp__kanna__edit",
])

function getPathArg(args: JsonObject): string | null {
  if (typeof args.path === "string") return args.path
  return null
}

function pathMatchesDeny(absPath: string, deny: string[]): string | null {
  for (const pattern of deny) {
    let expanded = pattern.startsWith("~")
      ? path.join(homedir(), pattern.slice(1).replace(/^\//, ""))
      : pattern
    if (expanded.endsWith("/") && expanded !== "/") expanded = expanded.slice(0, -1)
    const matchPattern = expanded.endsWith("/**") || expanded.includes("*")
      ? expanded
      : `${expanded}/**`
    if (minimatch(absPath, matchPattern, { dot: true }) || absPath === expanded) {
      return pattern
    }
  }
  return null
}

const INTERACTIVE_TOOLS = new Set([
  "mcp__kanna__ask_user_question",
  "mcp__kanna__exit_plan_mode",
])

export const policy = {
  evaluate(args: EvaluateArgs): EvaluateResult {
    if (INTERACTIVE_TOOLS.has(args.toolName)) {
      return { verdict: "ask", reason: "interactive tool: always asks the user" }
    }
    const roots = args.restrictedAllowedPaths && args.restrictedAllowedPaths.length > 0
      ? args.restrictedAllowedPaths
      : null
    const checkRestrictedPath = (p: string): EvaluateResult | null => {
      if (!roots) return null
      const expanded = p.startsWith("~")
        ? path.join(homedir(), p.slice(1).replace(/^\//, ""))
        : p
      const resolved = path.resolve(args.cwd, expanded)
      if (!pathInsideAllowedRoots(resolved, roots)) {
        return { verdict: "auto-deny", reason: `restrictedAllowedPaths: ${p}` }
      }
      return null
    }
    if (READ_PATH_TOOLS.has(args.toolName)) {
      const p = getPathArg(args.args)
      if (p !== null) {
        const restricted = checkRestrictedPath(p)
        if (restricted) return restricted
        const expanded = p.startsWith("~")
          ? path.join(homedir(), p.slice(1).replace(/^\//, ""))
          : p
        const resolved = path.resolve(args.cwd, expanded)
        const denied = pathMatchesDeny(resolved, args.chatPolicy.readPathDeny)
        if (denied) {
          return { verdict: "auto-deny", reason: `readPathDeny: ${denied}` }
        }
      }
    }
    if (WRITE_PATH_TOOLS.has(args.toolName)) {
      const p = getPathArg(args.args)
      if (p !== null) {
        const restricted = checkRestrictedPath(p)
        if (restricted) return restricted
        const expanded = p.startsWith("~")
          ? path.join(homedir(), p.slice(1).replace(/^\//, ""))
          : p
        const resolved = path.resolve(args.cwd, expanded)
        const deniedW = pathMatchesDeny(resolved, args.chatPolicy.writePathDeny)
        const deniedR = pathMatchesDeny(resolved, args.chatPolicy.readPathDeny)
        if (deniedW) return { verdict: "auto-deny", reason: `writePathDeny: ${deniedW}` }
        if (deniedR) return { verdict: "auto-deny", reason: `readPathDeny: ${deniedR}` }
      }
    }

    if (args.toolName === "mcp__kanna__bash") {
      const command = typeof args.args.command === "string" ? args.args.command : ""
      const parsed = parseSimpleBash(command, args.cwd, args.chatPolicy.bash.autoAllowVerbs)
      const fallback: PolicyVerdict = args.chatPolicy.defaultAction === "ask"
        ? "ask"
        : args.chatPolicy.defaultAction
      for (const rule of args.chatPolicy.toolDenyList) {
        if (rule.tool !== args.toolName) continue
        let re: RegExp
        try {
          re = new RegExp(rule.pattern)
        } catch {
          log.warn(`[permission-gate] invalid regex pattern: ${rule.pattern}`)
          continue
        }
        if (re.test(argsToText(args.args))) {
          return { verdict: "auto-deny", reason: `matched denylist: ${rule.pattern}` }
        }
      }
      if (!parsed) {
        return { verdict: fallback, reason: "bash command uses shell features" }
      }
      if (parsed.hadEnvPrefix) {
        return { verdict: fallback, reason: "bash command has env prefix" }
      }
      for (const p of parsed.paths) {
        if (roots && !pathInsideAllowedRoots(p, roots)) {
          return { verdict: "auto-deny", reason: `restrictedAllowedPaths: ${p}` }
        }
        const denied = pathMatchesDeny(p, args.chatPolicy.readPathDeny)
        if (denied) {
          return { verdict: "auto-deny", reason: `readPathDeny: ${denied}` }
        }
      }
      if (args.chatPolicy.bash.autoAllowVerbs.includes(parsed.verb)) {
        return { verdict: "auto-allow", reason: `verb in autoAllowVerbs: ${parsed.verb}` }
      }
      return { verdict: fallback, reason: "bash verb not on autoAllowVerbs" }
    }

    for (const rule of args.chatPolicy.toolDenyList) {
      if (rule.tool !== args.toolName) continue
      let re: RegExp
      try {
        re = new RegExp(rule.pattern)
      } catch {
        log.warn(`[permission-gate] invalid regex pattern: ${rule.pattern}`)
        continue
      }
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-deny", reason: `matched denylist: ${rule.pattern}` }
      }
    }

    for (const rule of args.chatPolicy.toolAllowList) {
      if (rule.tool !== args.toolName) continue
      let re: RegExp
      try {
        re = new RegExp(rule.pattern)
      } catch {
        log.warn(`[permission-gate] invalid regex pattern: ${rule.pattern}`)
        continue
      }
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-allow", reason: `matched allowlist: ${rule.pattern}` }
      }
    }

    return { verdict: args.chatPolicy.defaultAction === "ask" ? "ask" : args.chatPolicy.defaultAction }
  },
}
