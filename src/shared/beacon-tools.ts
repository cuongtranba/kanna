import type { JsonObject } from "./json"
import type { BeaconToolOp } from "./tool-call-types"

export const BEACON_LIST_TOOL_NAME = "mcp__kanna__beacon_list"
export const BEACON_READ_TOOL_NAME = "mcp__kanna__beacon_read"
export const BEACON_STAT_TOOL_NAME = "mcp__kanna__beacon_stat"
export const BEACON_GLOB_TOOL_NAME = "mcp__kanna__beacon_glob"
export const BEACON_GREP_TOOL_NAME = "mcp__kanna__beacon_grep"
export const BEACON_FETCH_TOOL_NAME = "mcp__kanna__beacon_fetch"
export const BEACON_EXEC_TOOL_NAME = "mcp__kanna__beacon_exec"
export const BEACON_SCRIPT_TOOL_NAME = "mcp__kanna__beacon_script"
export const BEACON_TOOL_PREFIX = "mcp__kanna__beacon_"

const BEACON_TOOL_OPS: ReadonlyMap<string, BeaconToolOp> = new Map([
  [BEACON_LIST_TOOL_NAME, "list"],
  [BEACON_READ_TOOL_NAME, "read"],
  [BEACON_STAT_TOOL_NAME, "stat"],
  [BEACON_GLOB_TOOL_NAME, "glob"],
  [BEACON_GREP_TOOL_NAME, "grep"],
  [BEACON_FETCH_TOOL_NAME, "fetch"],
  [BEACON_EXEC_TOOL_NAME, "exec"],
  [BEACON_SCRIPT_TOOL_NAME, "script"],
])

export function beaconToolOp(toolName: string): BeaconToolOp | null {
  return BEACON_TOOL_OPS.get(toolName) ?? null
}

function readStringInput(input: JsonObject, key: string): string {
  const value = input[key]
  return typeof value === "string" ? value : ""
}

export function summarizeBeaconCall(op: BeaconToolOp, input: JsonObject): string {
  switch (op) {
    case "list":
      return "list beacons"
    case "read":
    case "stat":
    case "glob":
    case "fetch":
      return `${op} ${readStringInput(input, "path")}`
    case "grep":
      return `grep ${readStringInput(input, "pattern")} in ${readStringInput(input, "root")}`
    case "exec": {
      const args = Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === "string") : []
      return ["exec", readStringInput(input, "cmd"), ...args].join(" ")
    }
    case "script":
      return `script (${readStringInput(input, "body").length} chars)`
  }
}
