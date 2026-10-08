import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "./json"
import type { BeaconScope } from "./beacon-scope"

export const BEACON_PROTOCOL_VERSION = 1
export const MIN_BEACON_PROTOCOL = 1

export type BeaconOs = "darwin" | "linux" | "windows"

export type BeaconRequest =
  | { op: "exec"; cmd: string; args: readonly string[]; cwd?: string }
  | { op: "script"; body: string }
  | { op: "read"; path: string; offset: number; limit: number }
  | { op: "grep"; root: string; pattern: string }
  | { op: "fetch"; path: string; chunkFrom?: number }
  | { op: "stat"; path: string }
  | { op: "glob"; path: string }

export type BeaconFrame =
  | { kind: "hello"; beaconId: string; protocolVersion: number; beaconVersion: string; os: BeaconOs }
  | { kind: "incompatible"; minSupported: number; downloadUrl?: string }
  | { kind: "challenge"; nonce: string }
  | { kind: "auth"; signature: string }
  | { kind: "ready"; scope: BeaconScope }
  | { kind: "ping" }
  | { kind: "pong" }
  | { kind: "request"; id: string; request: BeaconRequest }
  | { kind: "stdout"; id: string; chunk: string }
  | { kind: "stderr"; id: string; chunk: string }
  | { kind: "exit"; id: string; code: number }
  | { kind: "result"; id: string; result: JsonValue }
  | { kind: "error"; id: string; message: string }

export function isSupportedProtocol(version: number): boolean {
  return version >= MIN_BEACON_PROTOCOL && version <= BEACON_PROTOCOL_VERSION
}

function readString(object: JsonObject, key: string): string | null {
  const value = object[key]
  return typeof value === "string" ? value : null
}

function readNumber(object: JsonObject, key: string): number | null {
  const value = object[key]
  return typeof value === "number" ? value : null
}

function readBoolean(object: JsonObject, key: string): boolean | null {
  const value = object[key]
  return typeof value === "boolean" ? value : null
}

function isString(value: JsonValue): value is string {
  return typeof value === "string"
}

function readStringList(object: JsonObject, key: string): readonly string[] | null {
  const value = object[key]
  if (!isJsonArray(value)) return null
  return value.every(isString) ? value : null
}

function readOptionalString(object: JsonObject, key: string): string | undefined | null {
  if (!(key in object)) return undefined
  return readString(object, key)
}

function readOptionalNumber(object: JsonObject, key: string): number | undefined | null {
  if (!(key in object)) return undefined
  return readNumber(object, key)
}

function readOs(object: JsonObject): BeaconOs | null {
  const value = readString(object, "os")
  switch (value) {
    case "darwin":
    case "linux":
    case "windows":
      return value
    default:
      return null
  }
}

function parseBeaconScope(value: JsonValue): BeaconScope | null {
  if (!isJsonObject(value)) return null
  const exec = readBoolean(value, "exec")
  const execAllowlist = readStringList(value, "execAllowlist")
  const autoRunScripts = readBoolean(value, "autoRunScripts")
  const trustedScriptHashes = "trustedScriptHashes" in value ? readStringList(value, "trustedScriptHashes") : []
  const readRoots = readStringList(value, "readRoots")
  const writeRoots = readStringList(value, "writeRoots")
  const perCallTimeoutMs = readNumber(value, "perCallTimeoutMs")
  const outputByteCap = readNumber(value, "outputByteCap")
  const maxConcurrent = readNumber(value, "maxConcurrent")
  if (
    exec === null ||
    execAllowlist === null ||
    autoRunScripts === null ||
    trustedScriptHashes === null ||
    readRoots === null ||
    writeRoots === null ||
    perCallTimeoutMs === null ||
    outputByteCap === null ||
    maxConcurrent === null
  ) {
    return null
  }
  return {
    exec,
    execAllowlist,
    autoRunScripts,
    trustedScriptHashes,
    readRoots,
    writeRoots,
    perCallTimeoutMs,
    outputByteCap,
    maxConcurrent,
  }
}

function parseExecRequest(object: JsonObject): BeaconRequest | null {
  const cmd = readString(object, "cmd")
  const args = readStringList(object, "args")
  const cwd = readOptionalString(object, "cwd")
  if (cmd === null || args === null || cwd === null) return null
  return cwd === undefined ? { op: "exec", cmd, args } : { op: "exec", cmd, args, cwd }
}

function parseReadRequest(object: JsonObject): BeaconRequest | null {
  const path = readString(object, "path")
  const offset = readNumber(object, "offset")
  const limit = readNumber(object, "limit")
  if (path === null || offset === null || limit === null) return null
  return { op: "read", path, offset, limit }
}

function parseGrepRequest(object: JsonObject): BeaconRequest | null {
  const root = readString(object, "root")
  const pattern = readString(object, "pattern")
  if (root === null || pattern === null) return null
  return { op: "grep", root, pattern }
}

function parseFetchRequest(object: JsonObject): BeaconRequest | null {
  const path = readString(object, "path")
  const chunkFrom = readOptionalNumber(object, "chunkFrom")
  if (path === null || chunkFrom === null) return null
  return chunkFrom === undefined ? { op: "fetch", path } : { op: "fetch", path, chunkFrom }
}

function parseBeaconRequest(value: JsonValue): BeaconRequest | null {
  if (!isJsonObject(value)) return null
  switch (readString(value, "op")) {
    case "exec":
      return parseExecRequest(value)
    case "script": {
      const body = readString(value, "body")
      return body === null ? null : { op: "script", body }
    }
    case "read":
      return parseReadRequest(value)
    case "grep":
      return parseGrepRequest(value)
    case "fetch":
      return parseFetchRequest(value)
    case "stat": {
      const path = readString(value, "path")
      return path === null ? null : { op: "stat", path }
    }
    case "glob": {
      const path = readString(value, "path")
      return path === null ? null : { op: "glob", path }
    }
    default:
      return null
  }
}

function parseHello(object: JsonObject): BeaconFrame | null {
  const beaconId = readString(object, "beaconId")
  const protocolVersion = readNumber(object, "protocolVersion")
  const beaconVersion = readString(object, "beaconVersion")
  const os = readOs(object)
  if (beaconId === null || protocolVersion === null || beaconVersion === null || os === null) return null
  return { kind: "hello", beaconId, protocolVersion, beaconVersion, os }
}

function parseIncompatible(object: JsonObject): BeaconFrame | null {
  const minSupported = readNumber(object, "minSupported")
  const downloadUrl = readOptionalString(object, "downloadUrl")
  if (minSupported === null || downloadUrl === null) return null
  return downloadUrl === undefined
    ? { kind: "incompatible", minSupported }
    : { kind: "incompatible", minSupported, downloadUrl }
}

function parseReady(object: JsonObject): BeaconFrame | null {
  const scope = parseBeaconScope(object.scope)
  return scope === null ? null : { kind: "ready", scope }
}

function parseRequestFrame(object: JsonObject): BeaconFrame | null {
  const id = readString(object, "id")
  const request = parseBeaconRequest(object.request)
  if (id === null || request === null) return null
  return { kind: "request", id, request }
}

function parseOutputFrame(object: JsonObject, kind: "stdout" | "stderr"): BeaconFrame | null {
  const id = readString(object, "id")
  const chunk = readString(object, "chunk")
  if (id === null || chunk === null) return null
  return { kind, id, chunk }
}

function parseExit(object: JsonObject): BeaconFrame | null {
  const id = readString(object, "id")
  const code = readNumber(object, "code")
  if (id === null || code === null) return null
  return { kind: "exit", id, code }
}

function parseResult(object: JsonObject): BeaconFrame | null {
  const id = readString(object, "id")
  if (id === null || !("result" in object)) return null
  return { kind: "result", id, result: object.result }
}

function parseErrorFrame(object: JsonObject): BeaconFrame | null {
  const id = readString(object, "id")
  const message = readString(object, "message")
  if (id === null || message === null) return null
  return { kind: "error", id, message }
}

export function parseBeaconFrame(value: JsonValue): BeaconFrame | null {
  if (!isJsonObject(value)) return null
  switch (readString(value, "kind")) {
    case "hello":
      return parseHello(value)
    case "incompatible":
      return parseIncompatible(value)
    case "challenge": {
      const nonce = readString(value, "nonce")
      return nonce === null ? null : { kind: "challenge", nonce }
    }
    case "auth": {
      const signature = readString(value, "signature")
      return signature === null ? null : { kind: "auth", signature }
    }
    case "ready":
      return parseReady(value)
    case "ping":
      return { kind: "ping" }
    case "pong":
      return { kind: "pong" }
    case "request":
      return parseRequestFrame(value)
    case "stdout":
      return parseOutputFrame(value, "stdout")
    case "stderr":
      return parseOutputFrame(value, "stderr")
    case "exit":
      return parseExit(value)
    case "result":
      return parseResult(value)
    case "error":
      return parseErrorFrame(value)
    default:
      return null
  }
}
