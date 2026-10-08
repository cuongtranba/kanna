import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { JsonValue } from "../shared/json"
import type { BeaconConfig } from "../shared/beacon-config"
import type { BeaconFrame, BeaconRequest } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import type { ToolArgs, ToolResult } from "./kanna-mcp-tool"
import { createBeaconRegistry, type BeaconRegistry, type BeaconSocket } from "./beacon-registry"
import { buildBeaconToolList, dispatchBeaconRequest } from "./kanna-mcp-beacon"
import { buildKannaMcpTools, type KannaMcpDelegationContext } from "./kanna-mcp"
import { createTestEventStore } from "./storage/test-helpers"
import { createToolCallbackService, type ToolCallbackService } from "./tool-callback"

type SendPayload = Parameters<BeaconSocket["send"]>[0]
type Responder = (request: BeaconRequest, id: string) => BeaconFrame[]

interface FakeTool {
  name: string
  description: string
  handler: (input: ToolArgs) => Promise<ToolResult>
}

const BEACON_ID = "beacon-1"
const LABEL = "Build box"

let dataDir = ""
let toolCallback: ToolCallbackService
let beacons: BeaconConfig[] = []

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-beacon-"))
  const store = createTestEventStore(dataDir)
  await store.initialize()
  toolCallback = createToolCallbackService({ store, serverSecret: "secret", now: () => 1, getBeacons: () => beacons })
})

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function beaconConfig(scope: Partial<BeaconScope>, enabled = true): BeaconConfig {
  return {
    id: BEACON_ID,
    label: LABEL,
    publicKey: "key",
    os: "linux",
    scope: { ...DEFAULT_BEACON_SCOPE, readRoots: ["/data"], ...scope },
    enabled,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  }
}

function recordingTool(name: string, description: string, _schema: object, handler: FakeTool["handler"]): FakeTool {
  return { name, description, handler }
}

function connectedRegistry(responder: Responder): { registry: BeaconRegistry; sent: BeaconFrame[] } {
  const registry = createBeaconRegistry()
  const sent: BeaconFrame[] = []
  registry.connect({
    beaconId: BEACON_ID,
    beaconVersion: "1.0.0",
    socket: {
      send(payload: SendPayload): number {
        const frame: BeaconFrame = JSON.parse(String(payload))
        sent.push(frame)
        if (frame.kind === "request") {
          const replies = responder(frame.request, frame.id)
          queueMicrotask(() => {
            for (const reply of replies) registry.routeInbound(BEACON_ID, reply)
          })
        }
        return sent.length
      },
    },
  })
  return { registry, sent }
}

function toolsFor(registry: BeaconRegistry, config: BeaconConfig, allowed = true, approve = true): Map<string, FakeTool> {
  beacons = [config]
  const list = buildBeaconToolList(
    {
      beaconRegistry: registry,
      getBeacons: () => beacons,
      chatId: "chat-1",
      allowed,
      approval: approve
        ? { toolCallback, sessionId: "session-1", cwd: dataDir, chatPolicy: POLICY_DEFAULT }
        : undefined,
    },
    recordingTool,
  )
  return new Map(list.map((entry) => [entry.name, entry]))
}

function textOf(result: ToolResult): string {
  return result.content[0].text
}

function resultFrame(id: string, result: JsonValue): BeaconFrame {
  return { kind: "result", id, result }
}

describe("beacon agent tools", () => {
  test("offers no tools unless the caller is allowed to use beacons", () => {
    const { registry } = connectedRegistry(() => [])
    expect(toolsFor(registry, beaconConfig({}), false).size).toBe(0)
  })

  test("offers the eight beacon tools when allowed", () => {
    const { registry } = connectedRegistry(() => [])
    expect([...toolsFor(registry, beaconConfig({})).keys()].sort()).toEqual([
      "beacon_exec",
      "beacon_fetch",
      "beacon_glob",
      "beacon_grep",
      "beacon_list",
      "beacon_read",
      "beacon_script",
      "beacon_stat",
    ])
  })

  test("beacon_list reports configured beacons with their online state and contacts no machine", async () => {
    const { registry, sent } = connectedRegistry(() => [])
    const tools = toolsFor(registry, beaconConfig({}))
    const result = await tools.get("beacon_list")!.handler({})
    expect(JSON.parse(textOf(result))).toEqual({
      beacons: [{ id: BEACON_ID, label: LABEL, os: "linux", online: true, enabled: true }],
    })
    expect(sent).toEqual([])
  })

  test("beacon_read returns the beacon's result and names the beacon", async () => {
    const { registry, sent } = connectedRegistry((request, id) => [
      resultFrame(id, { path: request.op === "read" ? request.path : "", text: "hello", total: 5 }),
    ])
    const tools = toolsFor(registry, beaconConfig({ autoRunScripts: true }))
    const result = await tools.get("beacon_read")!.handler({ beaconId: BEACON_ID, path: "/data/notes.txt" })
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toContain(`${LABEL} (${BEACON_ID})`)
    expect(textOf(result)).toContain('"text":"hello"')
    expect(sent.map((frame) => (frame.kind === "request" ? frame.request : null))).toEqual([
      { op: "read", path: "/data/notes.txt", offset: 0, limit: 65536 },
    ])
  })

  test("an unknown beaconId fails without contacting any machine", async () => {
    const { registry, sent } = connectedRegistry(() => [])
    const tools = toolsFor(registry, beaconConfig({ autoRunScripts: true }))
    const result = await tools.get("beacon_read")!.handler({ beaconId: "nope", path: "/data/a" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("unknown beacon")
    expect(sent).toEqual([])
  })

  test("an offline beacon fails with a clear message", async () => {
    const registry = createBeaconRegistry()
    const tools = toolsFor(registry, beaconConfig({ autoRunScripts: true }))
    const result = await tools.get("beacon_read")!.handler({ beaconId: BEACON_ID, path: "/data/a" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("offline")
    expect(textOf(result)).toContain(LABEL)
  })

  test("a read outside the read roots is denied before it reaches the beacon", async () => {
    const { registry, sent } = connectedRegistry(() => [])
    const tools = toolsFor(registry, beaconConfig({ autoRunScripts: true }))
    const result = await tools.get("beacon_read")!.handler({ beaconId: BEACON_ID, path: "/etc/passwd" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("denied")
    expect(sent).toEqual([])
  })

  test("without an approval service a beacon call is refused rather than run", async () => {
    const { registry, sent } = connectedRegistry(() => [])
    const tools = toolsFor(registry, beaconConfig({ autoRunScripts: true }), true, false)
    const result = await tools.get("beacon_read")!.handler({ beaconId: BEACON_ID, path: "/data/a" })
    expect(result.isError).toBe(true)
    expect(sent).toEqual([])
  })

  test("beacon_exec summarises streamed output and the exit code", async () => {
    const { registry } = connectedRegistry((_request, id) => [
      { kind: "stdout", id, chunk: "building " },
      { kind: "stdout", id, chunk: "done\n" },
      { kind: "stderr", id, chunk: "warn: slow\n" },
      { kind: "exit", id, code: 3 },
    ])
    const tools = toolsFor(registry, beaconConfig({ exec: true, autoRunScripts: true }))
    const result = await tools.get("beacon_exec")!.handler({ beaconId: BEACON_ID, cmd: "make", args: ["all"] })
    const text = textOf(result)
    expect(result.isError).toBeUndefined()
    expect(text).toContain(`${LABEL} (${BEACON_ID})`)
    expect(text).toContain("exit 3")
    expect(text).toContain("building done")
    expect(text).toContain("warn: slow")
  })

  test("an error frame from the beacon becomes a failed tool result", async () => {
    const { registry } = connectedRegistry((_request, id) => [{ kind: "error", id, message: "outside realpath scope" }])
    const tools = toolsFor(registry, beaconConfig({ autoRunScripts: true }))
    const result = await tools.get("beacon_stat")!.handler({ beaconId: BEACON_ID, path: "/data/link" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("outside realpath scope")
  })
})

const SUBAGENT_CONTEXT: KannaMcpDelegationContext = {
  parentSubagentId: "sub-1",
  parentRunId: "run-1",
  ancestorSubagentIds: ["sub-1"],
  depth: 1,
  getParentUserMessageId: () => null,
  getMentionedSubagentIds: () => [],
}

function subagentToolNames(beaconToolsAllowed: boolean | undefined): string[] {
  const { registry } = connectedRegistry(() => [])
  beacons = [beaconConfig({})]
  return buildKannaMcpTools({
    projectId: "p",
    localPath: dataDir,
    chatId: "chat-1",
    sessionId: "session-1",
    chatPolicy: POLICY_DEFAULT,
    tunnelGateway: null,
    toolCallback,
    delegationContext: SUBAGENT_CONTEXT,
    beaconRegistry: registry,
    getBeacons: () => beacons,
    beaconToolsAllowed,
  }).map((entry) => entry.name)
}

describe("beacon tools inside a subagent session", () => {
  test("a granted subagent gets the beacon tools but not the built-in file and shell shims", () => {
    const names = subagentToolNames(true)
    expect(names).toContain("beacon_exec")
    expect(names).toContain("beacon_read")
    expect(names).not.toContain("bash")
    expect(names).not.toContain("read")
    expect(names).not.toContain("write")
  })

  test("a subagent that was not granted beacon tools gets none", () => {
    expect(subagentToolNames(false).filter((name) => name.startsWith("beacon_"))).toEqual([])
  })

  test("a subagent session with no explicit grant defaults to no beacon tools", () => {
    expect(subagentToolNames(undefined).filter((name) => name.startsWith("beacon_"))).toEqual([])
  })
})

describe("dispatchBeaconRequest", () => {
  test("stops capturing output past the byte cap and reports truncation", async () => {
    const { registry } = connectedRegistry((_request, id) => [
      { kind: "stdout", id, chunk: "a".repeat(40) },
      { kind: "stdout", id, chunk: "b".repeat(40) },
      { kind: "exit", id, code: 0 },
    ])
    const outcome = await dispatchBeaconRequest(registry, BEACON_ID, { op: "exec", cmd: "yes", args: [] }, { captureBytes: 50 })
    expect(outcome.stdout).toBe("a".repeat(40) + "b".repeat(10))
    expect(outcome.truncated).toBe(true)
    expect(outcome.exit).toBe(0)
  })

  test("rejects when the beacon never answers within the timeout", async () => {
    const { registry } = connectedRegistry(() => [])
    const outcome = dispatchBeaconRequest(registry, BEACON_ID, { op: "stat", path: "/data/a" }, { timeoutMs: 5 })
    await expect(outcome).rejects.toThrow("no answer")
  })
})
