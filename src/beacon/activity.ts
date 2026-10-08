import type { BeaconRequest } from "../shared/beacon-protocol"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"

export type BeaconActivityVerb = "read" | "list" | "search" | "run" | "script"

export type BeaconActivityOutcome =
  | { kind: "done" }
  | { kind: "exit"; code: number }
  | { kind: "failed"; message: string }
  | { kind: "refused"; message: string }

export interface BeaconActivity {
  id: string
  at: number
  verb: BeaconActivityVerb
  target: string
  outcome: BeaconActivityOutcome
}

const SCRIPT_TARGET_MAX = 120

function firstLine(body: string): string {
  const line = body.split(/\r?\n/).find((candidate) => candidate.trim().length > 0) ?? ""
  const trimmed = line.trim()
  return trimmed.length > SCRIPT_TARGET_MAX ? `${trimmed.slice(0, SCRIPT_TARGET_MAX - 1)}…` : trimmed
}

export function describeBeaconRequest(request: BeaconRequest): { verb: BeaconActivityVerb; target: string } {
  switch (request.op) {
    case "read":
    case "fetch":
      return { verb: "read", target: request.path }
    case "stat":
    case "glob":
      return { verb: "list", target: request.path }
    case "grep":
      return { verb: "search", target: `${request.pattern} in ${request.root}` }
    case "exec":
      return { verb: "run", target: [request.cmd, ...request.args].join(" ") }
    case "script":
      return { verb: "script", target: firstLine(request.body) }
  }
}

const VERBS: ReadonlySet<string> = new Set<BeaconActivityVerb>(["read", "list", "search", "run", "script"])

function isVerb(value: JsonValue | undefined): value is BeaconActivityVerb {
  return typeof value === "string" && VERBS.has(value)
}

function parseOutcome(value: JsonValue | undefined): BeaconActivityOutcome | null {
  if (value === undefined || !isJsonObject(value)) return null
  const outcome: JsonObject = value
  switch (outcome.kind) {
    case "done":
      return { kind: "done" }
    case "exit":
      return typeof outcome.code === "number" ? { kind: "exit", code: outcome.code } : null
    case "failed":
    case "refused":
      return typeof outcome.message === "string" ? { kind: outcome.kind, message: outcome.message } : null
    default:
      return null
  }
}

export function parseBeaconActivity(value: JsonValue): BeaconActivity | null {
  if (!isJsonObject(value)) return null
  const { id, at, verb, target } = value
  const outcome = parseOutcome(value.outcome)
  if (typeof id !== "string" || typeof at !== "number" || !isVerb(verb) || typeof target !== "string" || outcome === null) {
    return null
  }
  return { id, at, verb, target, outcome }
}
