import type { BeaconRequest } from "./beacon-protocol"
import type { JsonValue } from "./json"
import type { BeaconToolOp } from "./tool-call-types"

export type BeaconToolArgs = Readonly<Record<string, JsonValue | undefined>>

export const DEFAULT_BEACON_READ_LIMIT = 65536

function readText(args: BeaconToolArgs, key: string): string | null {
  const value = args[key]
  return typeof value === "string" && value !== "" ? value : null
}

function readOptionalText(args: BeaconToolArgs, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" && value !== "" ? value : undefined
}

function readWholeNumber(args: BeaconToolArgs, key: string): number | undefined {
  const value = args[key]
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function readTextList(args: BeaconToolArgs, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function buildFetchRequest(path: string, args: BeaconToolArgs): BeaconRequest {
  const chunkFrom = readWholeNumber(args, "chunkFrom")
  return chunkFrom === undefined ? { op: "fetch", path } : { op: "fetch", path, chunkFrom }
}

function buildExecRequest(cmd: string, args: BeaconToolArgs): BeaconRequest {
  const cwd = readOptionalText(args, "cwd")
  const execArgs = readTextList(args, "args")
  return cwd === undefined ? { op: "exec", cmd, args: execArgs } : { op: "exec", cmd, args: execArgs, cwd }
}

export function buildBeaconRequest(op: BeaconToolOp, args: BeaconToolArgs): BeaconRequest | null {
  switch (op) {
    case "list":
      return null
    case "read": {
      const path = readText(args, "path")
      if (path === null) return null
      return {
        op: "read",
        path,
        offset: readWholeNumber(args, "offset") ?? 0,
        limit: readWholeNumber(args, "limit") ?? DEFAULT_BEACON_READ_LIMIT,
      }
    }
    case "stat": {
      const path = readText(args, "path")
      return path === null ? null : { op: "stat", path }
    }
    case "glob": {
      const path = readText(args, "path")
      return path === null ? null : { op: "glob", path }
    }
    case "fetch": {
      const path = readText(args, "path")
      return path === null ? null : buildFetchRequest(path, args)
    }
    case "grep": {
      const root = readText(args, "root")
      const pattern = readText(args, "pattern")
      return root === null || pattern === null ? null : { op: "grep", root, pattern }
    }
    case "exec": {
      const cmd = readText(args, "cmd")
      return cmd === null ? null : buildExecRequest(cmd, args)
    }
    case "script": {
      const body = readText(args, "body")
      return body === null ? null : { op: "script", body }
    }
  }
}
