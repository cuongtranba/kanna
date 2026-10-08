import { expect, test } from "bun:test"
import {
  BEACON_PROTOCOL_VERSION,
  MIN_BEACON_PROTOCOL,
  SCOPE_SYNC_PROTOCOL,
  isSupportedProtocol,
  parseBeaconFrame,
  type BeaconFrame,
} from "./beacon-protocol"
import { DEFAULT_BEACON_SCOPE } from "./beacon-scope"
import type { JsonValue } from "./json"

const FRAMES: readonly BeaconFrame[] = [
  { kind: "hello", beaconId: "b1", protocolVersion: BEACON_PROTOCOL_VERSION, beaconVersion: "0.1.0", os: "linux" },
  { kind: "challenge", nonce: "abc123" },
  { kind: "auth", signature: "sig" },
  { kind: "ready", scope: { ...DEFAULT_BEACON_SCOPE, exec: true, execAllowlist: ["git"], readRoots: ["/srv"] } },
  { kind: "request", id: "r1", request: { op: "exec", cmd: "git", args: ["status"], cwd: "/srv" } },
  { kind: "ready", scope: DEFAULT_BEACON_SCOPE, protocolVersion: BEACON_PROTOCOL_VERSION },
  { kind: "scope", scope: { ...DEFAULT_BEACON_SCOPE, readRoots: ["C:\\Users\\me\\Documents"] } },
  { kind: "set-scope", change: { readRoots: ["/home/me/notes"], exec: true, autoRunScripts: false } },
  { kind: "set-scope", change: { exec: false } },
  { kind: "unpair" },
  { kind: "refused", reason: "unknown-beacon" },
  { kind: "refused", reason: "disabled" },
]

function asJson(frame: BeaconFrame): JsonValue {
  return JSON.parse(JSON.stringify(frame))
}

test("valid handshake and request frames round-trip through the parser", () => {
  for (const frame of FRAMES) {
    expect(parseBeaconFrame(asJson(frame))).toEqual(frame)
  }
})

test("a frame with an unknown kind is rejected", () => {
  expect(parseBeaconFrame({ kind: "teleport", id: "x" })).toBeNull()
})

test("a request with an unknown op is rejected", () => {
  expect(parseBeaconFrame({ kind: "request", id: "r1", request: { op: "format", path: "/" } })).toBeNull()
})

test("a hello whose protocolVersion is a string is rejected", () => {
  expect(
    parseBeaconFrame({ kind: "hello", beaconId: "b1", protocolVersion: "1", beaconVersion: "0.1.0", os: "linux" }),
  ).toBeNull()
})

test("a set-scope whose readRoots holds a non-string is rejected", () => {
  expect(parseBeaconFrame({ kind: "set-scope", change: { readRoots: ["/a", 3] } })).toBeNull()
})

test("a set-scope with a non-boolean exec is rejected", () => {
  expect(parseBeaconFrame({ kind: "set-scope", change: { exec: "yes" } })).toBeNull()
})

test("a refused frame with an unknown reason is rejected", () => {
  expect(parseBeaconFrame({ kind: "refused", reason: "maybe" })).toBeNull()
})

test("a ready frame from a server that predates scope sync parses without a protocolVersion", () => {
  const legacy = parseBeaconFrame(asJson({ kind: "ready", scope: DEFAULT_BEACON_SCOPE }))
  expect(legacy).toEqual({ kind: "ready", scope: DEFAULT_BEACON_SCOPE })
})

test("scope sync starts at protocol 2 and a version 1 beacon is still accepted", () => {
  expect(SCOPE_SYNC_PROTOCOL).toBe(2)
  expect(BEACON_PROTOCOL_VERSION).toBeGreaterThanOrEqual(SCOPE_SYNC_PROTOCOL)
  expect(isSupportedProtocol(1)).toBe(true)
})

test("a frame spelled as a bare string is rejected", () => {
  expect(parseBeaconFrame("ping")).toBeNull()
})

test("protocol versions inside the supported window are accepted and others refused", () => {
  expect(isSupportedProtocol(MIN_BEACON_PROTOCOL)).toBe(true)
  expect(isSupportedProtocol(BEACON_PROTOCOL_VERSION)).toBe(true)
  expect(isSupportedProtocol(MIN_BEACON_PROTOCOL - 1)).toBe(false)
  expect(isSupportedProtocol(BEACON_PROTOCOL_VERSION + 1)).toBe(false)
})
