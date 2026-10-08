import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { BeaconConfig } from "../shared/beacon-config"
import type { BeaconRequest } from "../shared/beacon-protocol"
import { buildBeaconStatusRows } from "../shared/beacon-status"
import { buildBeaconRequest } from "../shared/beacon-tool-request"
import type { BeaconToolOp } from "../shared/tool-call-types"
import { errorMessage } from "../shared/errors"
import type { JsonObject, JsonValue } from "../shared/json"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { BeaconRegistry } from "./beacon-registry"
import type { BoardToolFactory } from "./kanna-mcp-boards"
import { ok, fail, type ToolArgs, type ToolResult } from "./kanna-mcp-tool"
import type { ToolCallbackService } from "./tool-callback"

export const BEACON_CAPTURE_BYTES = 100_000
export const BEACON_REQUEST_TIMEOUT_MS = 600_000

export interface BeaconDispatchOptions {
  captureBytes?: number
  timeoutMs?: number
}

export interface BeaconDispatchOutcome {
  result?: JsonValue
  stdout: string
  stderr: string
  exit?: number
  truncated: boolean
}

export interface BeaconApproval {
  toolCallback: ToolCallbackService
  sessionId: string
  cwd: string
  chatPolicy: ChatPermissionPolicy
  restrictedAllowedPaths?: readonly string[]
}

export interface BeaconToolContext {
  beaconRegistry?: BeaconRegistry
  getBeacons: () => readonly BeaconConfig[]
  chatId: string | null
  allowed: boolean
  approval?: BeaconApproval
  dispatchOptions?: BeaconDispatchOptions
}

const LIST_DESCRIPTION =
  "List the user's paired machines (beacons) with their id, label, OS, online state and whether they are enabled. "
  + "Metadata only: nothing is sent to any machine."

const READ_DESCRIPTION =
  "Read a window of a text file on a beacon (a paired remote machine). Returns at most `limit` bytes starting at `offset` "
  + "plus the file's total size, so page through large files. Prefer beacon_grep to find a line in a big file and "
  + "beacon_fetch to pull a whole file or a binary one. The path must be inside the beacon's read roots."

const STAT_DESCRIPTION = "Return size, kind and modification time of a path on a beacon without reading its contents."

const GLOB_DESCRIPTION = "List the paths on a beacon that match a glob pattern inside its read roots."

const GREP_DESCRIPTION =
  "Search file contents under a root directory on a beacon for a pattern and return matching lines with file and line "
  + "number. Cheaper than reading large files when you only need the matches."

const FETCH_DESCRIPTION =
  "Fetch a whole file from a beacon in checksummed chunks, including binary files that beacon_read refuses. "
  + "Large files arrive in several chunks: call again with chunkFrom set to the offset the previous reply ended at."

const EXEC_DESCRIPTION =
  "Run one command with arguments on a beacon (no shell). Returns the exit code plus captured stdout and stderr. "
  + "Commands outside the beacon's allowlist wait for the user's approval."

const SCRIPT_DESCRIPTION =
  "Run a multi-line script on a beacon. The user sees the full script body before it runs unless they enabled "
  + "auto-run for that machine. Returns the exit code plus captured stdout and stderr."

function appendCapped(current: string, chunk: string, remaining: number): { text: string; clipped: boolean } {
  if (remaining <= 0) return { text: current, clipped: chunk !== "" }
  const bytes = Buffer.from(chunk, "utf8")
  if (bytes.byteLength <= remaining) return { text: current + chunk, clipped: false }
  return { text: current + bytes.subarray(0, remaining).toString("utf8"), clipped: true }
}

export function dispatchBeaconRequest(
  registry: BeaconRegistry,
  beaconId: string,
  request: BeaconRequest,
  options: BeaconDispatchOptions = {},
): Promise<BeaconDispatchOutcome> {
  const captureBytes = options.captureBytes ?? BEACON_CAPTURE_BYTES
  const timeoutMs = options.timeoutMs ?? BEACON_REQUEST_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let truncated = false
    let settled = false
    let cancel: () => void = () => undefined
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`no answer from the beacon within ${String(timeoutMs)} ms`)))
    }, timeoutMs)

    function finish(settle: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cancel()
      settle()
    }

    function capture(stream: "stdout" | "stderr", chunk: string): void {
      const current = stream === "stdout" ? stdout : stderr
      const other = stream === "stdout" ? stderr : stdout
      const remaining = captureBytes - Buffer.byteLength(current, "utf8") - Buffer.byteLength(other, "utf8")
      const appended = appendCapped(current, chunk, remaining)
      if (appended.clipped) truncated = true
      if (stream === "stdout") stdout = appended.text
      else stderr = appended.text
    }

    const dispatched = registry.dispatch(beaconId, request, {
      onStdout: (chunk) => capture("stdout", chunk),
      onStderr: (chunk) => capture("stderr", chunk),
      onResult: (result) => finish(() => resolve({ result, stdout, stderr, truncated })),
      onExit: (code) => finish(() => resolve({ stdout, stderr, exit: code, truncated })),
      onError: (message) => finish(() => reject(new Error(message))),
    })
    cancel = dispatched.cancel
    if (settled) cancel()
  })
}

function toJsonObject(input: ToolArgs): JsonObject {
  const entries = Object.entries(input).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
  return Object.fromEntries(entries)
}

function describeBeacon(beacon: BeaconConfig): string {
  return `${beacon.label} (${beacon.id})`
}

function formatStream(name: string, text: string): string {
  return text === "" ? "" : `\n--- ${name} ---\n${text}`
}

function formatOutcome(beacon: BeaconConfig, op: BeaconToolOp, outcome: BeaconDispatchOutcome): string {
  const head = `Beacon ${describeBeacon(beacon)} ${op}`
  if (outcome.exit === undefined) return `${head}\n${JSON.stringify(outcome.result ?? null)}`
  const note = outcome.truncated ? `\n[output truncated at ${String(BEACON_CAPTURE_BYTES)} bytes]` : ""
  return `${head}: exit ${String(outcome.exit)}${formatStream("stdout", outcome.stdout)}${formatStream("stderr", outcome.stderr)}${note}`
}

export function buildBeaconToolList<TTool>(deps: BeaconToolContext, tool: BoardToolFactory<TTool>): TTool[] {
  const { beaconRegistry, chatId } = deps
  if (!deps.allowed || !beaconRegistry || !chatId) return []
  const registry = beaconRegistry
  const owner = chatId

  async function authorize(beacon: BeaconConfig, name: string, input: ToolArgs): Promise<string | null> {
    const approval = deps.approval
    if (!approval) return `Beacon ${describeBeacon(beacon)}: no approval service is available, so ${name} was not run`
    const decision = await approval.toolCallback.submit({
      chatId: owner,
      sessionId: approval.sessionId,
      toolUseId: randomUUID(),
      toolName: `mcp__kanna__${name}`,
      args: toJsonObject(input),
      chatPolicy: approval.chatPolicy,
      cwd: approval.cwd,
      restrictedAllowedPaths: approval.restrictedAllowedPaths,
    })
    if (decision.decision.kind === "allow" || decision.decision.kind === "answer") return null
    return `Beacon ${describeBeacon(beacon)}: ${name} was denied (${decision.decision.reason ?? "no reason given"})`
  }

  function resolveBeacon(input: ToolArgs): BeaconConfig | string {
    const beaconId = typeof input.beaconId === "string" ? input.beaconId : ""
    const beacon = deps.getBeacons().find((candidate) => candidate.id === beaconId)
    if (!beacon) return `unknown beacon: ${beaconId}`
    if (!beacon.enabled) return `Beacon ${describeBeacon(beacon)} is disabled`
    if (!registry.isOnline(beacon.id)) return `Beacon ${describeBeacon(beacon)} is offline`
    return beacon
  }

  async function run(name: string, op: BeaconToolOp, input: ToolArgs): Promise<ToolResult> {
    const beacon = resolveBeacon(input)
    if (typeof beacon === "string") return fail(beacon)
    const request = buildBeaconRequest(op, input)
    if (request === null) return fail(`Beacon ${describeBeacon(beacon)}: ${name} is missing a required argument`)
    const refusal = await authorize(beacon, name, input)
    if (refusal !== null) return fail(refusal)
    try {
      const outcome = await dispatchBeaconRequest(registry, beacon.id, request, deps.dispatchOptions)
      return ok(formatOutcome(beacon, op, outcome))
    } catch (error) {
      return fail(`Beacon ${describeBeacon(beacon)} ${op} failed: ${errorMessage(error)}`)
    }
  }

  const beaconId = z.string().min(1).describe("Id of the beacon, from beacon_list")
  const path = z.string().min(1)

  return [
    tool("beacon_list", LIST_DESCRIPTION, {}, async () => {
      const rows = buildBeaconStatusRows(deps.getBeacons(), registry.live())
      const summary = rows.map((row) => ({ id: row.id, label: row.label, os: row.os, online: row.online, enabled: row.enabled }))
      return ok(JSON.stringify({ beacons: summary }))
    }),
    tool(
      "beacon_read",
      READ_DESCRIPTION,
      { beaconId, path, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).optional() },
      (input) => run("beacon_read", "read", input),
    ),
    tool("beacon_stat", STAT_DESCRIPTION, { beaconId, path }, (input) => run("beacon_stat", "stat", input)),
    tool("beacon_glob", GLOB_DESCRIPTION, { beaconId, path }, (input) => run("beacon_glob", "glob", input)),
    tool(
      "beacon_grep",
      GREP_DESCRIPTION,
      { beaconId, root: z.string().min(1), pattern: z.string().min(1) },
      (input) => run("beacon_grep", "grep", input),
    ),
    tool(
      "beacon_fetch",
      FETCH_DESCRIPTION,
      { beaconId, path, chunkFrom: z.number().int().min(0).optional() },
      (input) => run("beacon_fetch", "fetch", input),
    ),
    tool(
      "beacon_exec",
      EXEC_DESCRIPTION,
      { beaconId, cmd: z.string().min(1), args: z.array(z.string()).optional(), cwd: z.string().min(1).optional() },
      (input) => run("beacon_exec", "exec", input),
    ),
    tool(
      "beacon_script",
      SCRIPT_DESCRIPTION,
      { beaconId, body: z.string().min(1) },
      (input) => run("beacon_script", "script", input),
    ),
  ]
}
