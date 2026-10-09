import type { BeaconRequest, BeaconScopeChange } from "./beacon-protocol"

export type BeaconScope = {
  exec: boolean
  execAllowlist: readonly string[]
  autoRunScripts: boolean
  trustedScriptHashes: readonly string[]
  readRoots: readonly string[]
  writeRoots: readonly string[]
  perCallTimeoutMs: number
  outputByteCap: number
  maxConcurrent: number
}

export const DEFAULT_BEACON_SCOPE: BeaconScope = {
  exec: false,
  execAllowlist: [],
  autoRunScripts: false,
  trustedScriptHashes: [],
  readRoots: [],
  writeRoots: [],
  perCallTimeoutMs: 30000,
  outputByteCap: 1_000_000,
  maxConcurrent: 2,
}

export type BeaconVerdict = "deny" | "allow" | "ask"

export type BeaconEvalContext = {
  trustedScriptHashes: ReadonlySet<string>
  scriptHash?: string
}

type NormalizedPath = {
  absolute: boolean
  drive: string | null
  segments: readonly string[]
}

const WINDOWS_DRIVE = /^[A-Za-z]:$/
const SEPARATORS = /[\\/]/

function normalizePath(path: string): NormalizedPath {
  const parts = path.split(SEPARATORS)
  const leadingSeparator = parts.length > 1 && parts[0] === ""
  const named = parts.filter((part) => part !== "" && part !== ".")
  const first = named[0]
  const drive = first !== undefined && WINDOWS_DRIVE.test(first) ? first.toUpperCase() : null
  const rest = drive === null ? named : named.slice(1)
  const absolute = leadingSeparator || drive !== null
  const segments: string[] = []
  for (const part of rest) {
    if (part !== "..") {
      segments.push(part)
      continue
    }
    const last = segments[segments.length - 1]
    if (last !== undefined && last !== "..") {
      segments.pop()
    } else if (!absolute) {
      segments.push(part)
    }
  }
  return { absolute, drive, segments }
}

function isInsideRoot(target: NormalizedPath, root: NormalizedPath): boolean {
  if (!root.absolute && root.segments.length === 0) return false
  if (target.absolute !== root.absolute) return false
  if (target.drive !== root.drive) return false
  if (root.segments.length > target.segments.length) return false
  return root.segments.every((segment, index) => segment === target.segments[index])
}

export const MAX_READ_ROOTS = 64
export const MAX_READ_ROOT_LENGTH = 1024

function isAcceptableReadRoot(root: string): boolean {
  if (root.length === 0 || root.length > MAX_READ_ROOT_LENGTH) return false
  const normalized = normalizePath(root)
  return normalized.absolute
}

function normalizeReadRoots(roots: readonly string[]): readonly string[] | null {
  if (roots.length > MAX_READ_ROOTS || !roots.every(isAcceptableReadRoot)) return null
  return [...new Set(roots)]
}

export function applyScopeChange(scope: BeaconScope, change: BeaconScopeChange): BeaconScope | null {
  const readRoots = change.readRoots === undefined ? scope.readRoots : normalizeReadRoots(change.readRoots)
  if (readRoots === null) return null
  return {
    ...scope,
    readRoots,
    exec: change.exec ?? scope.exec,
    autoRunScripts: change.autoRunScripts ?? scope.autoRunScripts,
  }
}

export function isPathInsideRoots(target: string, roots: readonly string[]): boolean {
  const normalizedTarget = normalizePath(target)
  return roots.some((root) => isInsideRoot(normalizedTarget, normalizePath(root)))
}

function commandVerb(cmd: string): string {
  const parts = cmd.split(SEPARATORS)
  return (parts[parts.length - 1] ?? "").toLowerCase()
}

function evaluateRead(scope: BeaconScope, path: string): BeaconVerdict {
  if (!isPathInsideRoots(path, scope.readRoots)) return "deny"
  return scope.autoRunScripts ? "allow" : "ask"
}

function evaluateWrite(scope: BeaconScope, path: string): BeaconVerdict {
  if (!isPathInsideRoots(path, scope.writeRoots)) return "deny"
  return scope.autoRunScripts ? "allow" : "ask"
}

function evaluateExec(scope: BeaconScope, cmd: string): BeaconVerdict {
  if (!scope.exec) return "deny"
  if (scope.autoRunScripts) return "allow"
  const verb = commandVerb(cmd)
  const allowed = scope.execAllowlist.some((entry) => entry.toLowerCase() === verb)
  return allowed ? "allow" : "ask"
}

function evaluateScript(scope: BeaconScope, context: BeaconEvalContext): BeaconVerdict {
  if (!scope.exec) return "deny"
  if (scope.autoRunScripts) return "allow"
  const hash = context.scriptHash
  if (hash !== undefined && hash !== "" && context.trustedScriptHashes.has(hash)) return "allow"
  return "ask"
}

export function evaluateBeaconRequest(
  scope: BeaconScope,
  request: BeaconRequest,
  context: BeaconEvalContext,
): BeaconVerdict {
  switch (request.op) {
    case "read":
    case "stat":
    case "glob":
    case "fetch":
    case "upload":
      return evaluateRead(scope, request.path)
    case "download":
      return evaluateWrite(scope, request.path)
    case "grep":
      return evaluateRead(scope, request.root)
    case "exec":
      return evaluateExec(scope, request.cmd)
    case "script":
      return evaluateScript(scope, context)
  }
}
