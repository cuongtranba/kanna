import { expect, test } from "bun:test"
import type { BeaconRequest } from "./beacon-protocol"
import {
  DEFAULT_BEACON_SCOPE,
  MAX_READ_ROOTS,
  MAX_READ_ROOT_LENGTH,
  applyScopeChange,
  evaluateBeaconRequest,
  type BeaconEvalContext,
  type BeaconScope,
} from "./beacon-scope"

const NO_TRUST: BeaconEvalContext = { trustedScriptHashes: new Set() }
const READ_ROOTED: BeaconScope = { ...DEFAULT_BEACON_SCOPE, readRoots: ["/srv/app"] }

function read(path: string): BeaconRequest {
  return { op: "read", path, offset: 0, limit: 100 }
}

function exec(cmd: string): BeaconRequest {
  return { op: "exec", cmd, args: [] }
}

const SCRIPT: BeaconRequest = { op: "script", body: "echo hi" }

test("a read inside a root asks while autoRunScripts is off", () => {
  expect(evaluateBeaconRequest(READ_ROOTED, read("/srv/app/log.txt"), NO_TRUST)).toBe("ask")
})

test("a read inside a root is allowed when autoRunScripts is on", () => {
  const scope = { ...READ_ROOTED, autoRunScripts: true }
  expect(evaluateBeaconRequest(scope, read("/srv/app/log.txt"), NO_TRUST)).toBe("allow")
})

test("a read outside every root is denied even with autoRunScripts on", () => {
  const scope = { ...READ_ROOTED, autoRunScripts: true }
  expect(evaluateBeaconRequest(scope, read("/etc/passwd"), NO_TRUST)).toBe("deny")
})

test("a read is denied when no read roots are granted", () => {
  expect(evaluateBeaconRequest(DEFAULT_BEACON_SCOPE, read("/srv/app/log.txt"), NO_TRUST)).toBe("deny")
})

test("a dot-dot path that escapes the root is denied", () => {
  expect(evaluateBeaconRequest(READ_ROOTED, read("/srv/app/../secrets/key"), NO_TRUST)).toBe("deny")
})

test("a sibling directory sharing the root's name prefix is denied", () => {
  expect(evaluateBeaconRequest(READ_ROOTED, read("/srv/app-old/log.txt"), NO_TRUST)).toBe("deny")
})

test("grep is judged by its root and windows paths match across separators", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, readRoots: ["C:\\Users\\dev"] }
  const inside: BeaconRequest = { op: "grep", root: "c:/Users/dev/src", pattern: "x" }
  const outside: BeaconRequest = { op: "grep", root: "D:/Users/dev/src", pattern: "x" }
  expect(evaluateBeaconRequest(scope, inside, NO_TRUST)).toBe("ask")
  expect(evaluateBeaconRequest(scope, outside, NO_TRUST)).toBe("deny")
})

test("exec is denied when exec is off", () => {
  expect(evaluateBeaconRequest(DEFAULT_BEACON_SCOPE, exec("git"), NO_TRUST)).toBe("deny")
})

test("exec of an allowlisted verb is allowed regardless of its path or case", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, exec: true, execAllowlist: ["git"] }
  expect(evaluateBeaconRequest(scope, exec("/usr/bin/Git"), NO_TRUST)).toBe("allow")
})

test("exec of an unlisted verb asks", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, exec: true, execAllowlist: ["git"] }
  expect(evaluateBeaconRequest(scope, exec("rm"), NO_TRUST)).toBe("ask")
})

test("exec of any verb is allowed when autoRunScripts is on", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, exec: true, autoRunScripts: true }
  expect(evaluateBeaconRequest(scope, exec("rm"), NO_TRUST)).toBe("allow")
})

test("a script is denied when exec is off", () => {
  const context = { trustedScriptHashes: new Set(["h1"]), scriptHash: "h1" }
  expect(evaluateBeaconRequest(DEFAULT_BEACON_SCOPE, SCRIPT, context)).toBe("deny")
})

test("a script with a trusted hash is allowed", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, exec: true }
  const context = { trustedScriptHashes: new Set(["h1"]), scriptHash: "h1" }
  expect(evaluateBeaconRequest(scope, SCRIPT, context)).toBe("allow")
})

test("a script with an untrusted or missing hash asks", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, exec: true }
  const trusted = new Set(["h1"])
  expect(evaluateBeaconRequest(scope, SCRIPT, { trustedScriptHashes: trusted, scriptHash: "h2" })).toBe("ask")
  expect(evaluateBeaconRequest(scope, SCRIPT, { trustedScriptHashes: trusted })).toBe("ask")
})

test("a script is allowed when autoRunScripts is on", () => {
  const scope = { ...DEFAULT_BEACON_SCOPE, exec: true, autoRunScripts: true }
  expect(evaluateBeaconRequest(scope, SCRIPT, NO_TRUST)).toBe("allow")
})

test("a scope change replaces only the fields it names", () => {
  const base: BeaconScope = { ...DEFAULT_BEACON_SCOPE, execAllowlist: ["git"], readRoots: ["/old"] }
  expect(applyScopeChange(base, { exec: true })).toEqual({ ...base, exec: true })
  expect(applyScopeChange(base, { readRoots: ["/home/me/notes", "D:\\Projects"] })).toEqual({
    ...base,
    readRoots: ["/home/me/notes", "D:\\Projects"],
  })
  expect(applyScopeChange(base, { autoRunScripts: true })).toEqual({ ...base, autoRunScripts: true })
})

test("a scope change drops duplicate folders and keeps their first order", () => {
  expect(applyScopeChange(DEFAULT_BEACON_SCOPE, { readRoots: ["/a", "/b", "/a"] })?.readRoots).toEqual(["/a", "/b"])
})

test("a scope change naming a relative, empty or oversized folder is refused whole", () => {
  expect(applyScopeChange(DEFAULT_BEACON_SCOPE, { readRoots: ["notes"] })).toBeNull()
  expect(applyScopeChange(DEFAULT_BEACON_SCOPE, { readRoots: [""] })).toBeNull()
  expect(applyScopeChange(DEFAULT_BEACON_SCOPE, { readRoots: [`/${"a".repeat(MAX_READ_ROOT_LENGTH)}`] })).toBeNull()
  const many = Array.from({ length: MAX_READ_ROOTS + 1 }, (_, index) => `/r${index}`)
  expect(applyScopeChange(DEFAULT_BEACON_SCOPE, { readRoots: many })).toBeNull()
})
