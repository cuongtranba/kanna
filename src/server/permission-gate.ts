import type {
  ChatPermissionPolicy,
  PolicyVerdict,
} from "../shared/permission-policy"
import { parse as shellParse } from "shell-quote"
import { minimatch } from "minimatch"
import { log } from "../shared/log"
import { isRecord } from "../shared/errors"
import type { JsonObject } from "../shared/json"
import type { BeaconConfig } from "../shared/beacon-config"
import { evaluateBeaconRequest, type BeaconEvalContext } from "../shared/beacon-scope"
import { beaconScriptHash } from "./beacon-crypto"
import { currentHomeDir } from "./home-dir.adapter"
import { expandHomePrefix, resolveUserPath } from "./home-path"
import { isInsideAny } from "./path-containment"
import { buildBeaconRequest } from "../shared/beacon-tool-request"
import { BEACON_LIST_TOOL_NAME, BEACON_TOOL_PREFIX, beaconToolOp } from "../shared/beacon-tools"
import { ASK_USER_QUESTION_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from "../shared/tools"

export interface EvaluateArgs {
  toolName: string
  args: JsonObject
  chatPolicy: ChatPermissionPolicy
  cwd: string
  restrictedAllowedPaths?: readonly string[]
  beacons?: readonly BeaconConfig[]
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
    paths.push(resolveUserPath(arg, cwd, currentHomeDir()))
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

export function pathMatchesDeny(absPath: string, deny: string[]): string | null {
  for (const pattern of deny) {
    let expanded = expandHomePrefix(pattern, currentHomeDir())
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

const INTERACTIVE_TOOLS = new Set([ASK_USER_QUESTION_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME])

const NO_TRUSTED_SCRIPT_HASHES: ReadonlySet<string> = new Set()

function beaconEvalContext(scope: BeaconConfig["scope"], request: NonNullable<ReturnType<typeof buildBeaconRequest>>): BeaconEvalContext {
  if (request.op !== "script") return { trustedScriptHashes: NO_TRUSTED_SCRIPT_HASHES }
  return {
    trustedScriptHashes: new Set(scope.trustedScriptHashes),
    scriptHash: beaconScriptHash(request.body),
  }
}

function evaluateBeaconTool(args: EvaluateArgs): EvaluateResult | null {
  if (!args.toolName.startsWith(BEACON_TOOL_PREFIX)) return null
  if (args.toolName === BEACON_LIST_TOOL_NAME) {
    return { verdict: "auto-allow", reason: "beacon_list reads metadata only" }
  }
  const op = beaconToolOp(args.toolName)
  if (op === null) return null
  const request = buildBeaconRequest(op, args.args)
  if (request === null) return null
  const beaconId = typeof args.args.beaconId === "string" ? args.args.beaconId : ""
  const beacon = (args.beacons ?? []).find((candidate) => candidate.id === beaconId)
  if (!beacon) return { verdict: "auto-deny", reason: `unknown beacon: ${beaconId}` }
  if (!beacon.enabled) return { verdict: "auto-deny", reason: `beacon ${beacon.label} (${beacon.id}) is disabled` }
  const verdict = evaluateBeaconRequest(beacon.scope, request, beaconEvalContext(beacon.scope, request))
  const subject = `beacon ${beacon.label} (${beacon.id}) ${op}`
  switch (verdict) {
    case "allow":
      return { verdict: "auto-allow", reason: `${subject} is within the beacon scope` }
    case "deny":
      return { verdict: "auto-deny", reason: `${subject} is outside the beacon scope` }
    case "ask":
      return { verdict: "ask", reason: `${subject} needs approval` }
  }
}

function firstMatchingRule(rules: ChatPermissionPolicy["toolDenyList"], toolName: string, args: JsonObject): string | null {
  const text = argsToText(args)
  for (const rule of rules) {
    if (rule.tool !== toolName) continue
    let re: RegExp
    try {
      re = new RegExp(rule.pattern)
    } catch {
      log.warn(`[permission-gate] invalid regex pattern: ${rule.pattern}`)
      continue
    }
    if (re.test(text)) return rule.pattern
  }
  return null
}

function evaluatePathTool(args: EvaluateArgs, roots: readonly string[] | null): EvaluateResult | null {
  const isRead = READ_PATH_TOOLS.has(args.toolName)
  if (!isRead && !WRITE_PATH_TOOLS.has(args.toolName)) return null
  const p = getPathArg(args.args)
  if (p === null) return null
  const resolved = resolveUserPath(p, args.cwd, currentHomeDir())
  if (roots && !isInsideAny(roots, resolved)) {
    return { verdict: "auto-deny", reason: `restrictedAllowedPaths: ${p}` }
  }
  if (!isRead) {
    const deniedWrite = pathMatchesDeny(resolved, args.chatPolicy.writePathDeny)
    if (deniedWrite) return { verdict: "auto-deny", reason: `writePathDeny: ${deniedWrite}` }
  }
  const deniedRead = pathMatchesDeny(resolved, args.chatPolicy.readPathDeny)
  if (deniedRead) return { verdict: "auto-deny", reason: `readPathDeny: ${deniedRead}` }
  return null
}

function evaluateBash(args: EvaluateArgs, roots: readonly string[] | null): EvaluateResult {
  const command = typeof args.args.command === "string" ? args.args.command : ""
  const parsed = parseSimpleBash(command, args.cwd, args.chatPolicy.bash.autoAllowVerbs)
  const fallback = args.chatPolicy.defaultAction
  const deniedPattern = firstMatchingRule(args.chatPolicy.toolDenyList, args.toolName, args.args)
  if (deniedPattern !== null) return { verdict: "auto-deny", reason: `matched denylist: ${deniedPattern}` }
  if (!parsed) {
    return { verdict: fallback, reason: "bash command uses shell features" }
  }
  if (parsed.hadEnvPrefix) {
    return { verdict: fallback, reason: "bash command has env prefix" }
  }
  for (const p of parsed.paths) {
    if (roots && !isInsideAny(roots, p)) {
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

export const policy = {
  evaluate(args: EvaluateArgs): EvaluateResult {
    if (INTERACTIVE_TOOLS.has(args.toolName)) {
      return { verdict: "ask", reason: "interactive tool: always asks the user" }
    }
    const roots = args.restrictedAllowedPaths && args.restrictedAllowedPaths.length > 0
      ? args.restrictedAllowedPaths
      : null

    const pathVerdict = evaluatePathTool(args, roots)
    if (pathVerdict) return pathVerdict

    if (args.toolName === "mcp__kanna__bash") return evaluateBash(args, roots)

    const deniedPattern = firstMatchingRule(args.chatPolicy.toolDenyList, args.toolName, args.args)
    if (deniedPattern !== null) return { verdict: "auto-deny", reason: `matched denylist: ${deniedPattern}` }

    const beaconVerdict = evaluateBeaconTool(args)
    if (beaconVerdict) return beaconVerdict

    const allowedPattern = firstMatchingRule(args.chatPolicy.toolAllowList, args.toolName, args.args)
    if (allowedPattern !== null) return { verdict: "auto-allow", reason: `matched allowlist: ${allowedPattern}` }

    return { verdict: args.chatPolicy.defaultAction }
  },
}
