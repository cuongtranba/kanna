import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createBeaconTransfer } from "../beacon/transfer.adapter"
import type { BeaconConfig } from "../shared/beacon-config"
import type { BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import { TRANSFER_PROTOCOL, type BeaconTransferResult } from "../shared/beacon-transfer"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import { createBeaconRegistry, type BeaconRegistry, type BeaconSocket } from "./beacon-registry"
import { createBeaconTransferTickets, type BeaconTransferTickets } from "./beacon-transfer-tickets"
import { buildBeaconToolList } from "./kanna-mcp-beacon"
import type { ToolArgs, ToolResult } from "./kanna-mcp-tool"
import { startKannaServer } from "./server"
import { createTestEventStore } from "./storage/test-helpers"
import { createToolCallbackService, type ToolCallbackService } from "./tool-callback"

type SendPayload = Parameters<BeaconSocket["send"]>[0]

interface ToolExtra {
  signal?: AbortSignal
}

interface FakeTool {
  name: string
  handler: (input: ToolArgs, extra?: ToolExtra) => Promise<ToolResult>
}

const BEACON_ID = "beacon-1"
const LABEL = "Lab PC"
const CHUNK = 1024

let dataDir = ""
let projectDir = ""
let remoteDir = ""
let base = ""
let stopServer: () => Promise<void> = async () => undefined
let toolCallback: ToolCallbackService
let beacons: BeaconConfig[] = []

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-pull-data-"))
  projectDir = await mkdtemp(path.join(tmpdir(), "kanna-pull-project-"))
  remoteDir = await mkdtemp(path.join(tmpdir(), "kanna-pull-remote-"))
  const server = await startKannaServer({
    dataDir: path.join(dataDir, "server"),
    port: 0,
    password: "secret",
    openBrowser: false,
    discoverProjects: () => [],
  })
  base = `http://127.0.0.1:${String(server.port)}`
  stopServer = server.stop
  const store = createTestEventStore(path.join(dataDir, "store"))
  await store.initialize()
  toolCallback = createToolCallbackService({ store, serverSecret: "secret", now: () => 1, getBeacons: () => beacons })
})

afterAll(async () => {
  await stopServer()
  await Promise.all([dataDir, projectDir, remoteDir].map((dir) => rm(dir, { recursive: true, force: true })))
})

function beaconConfig(scope: Partial<BeaconScope>): BeaconConfig {
  return {
    id: BEACON_ID,
    label: LABEL,
    publicKey: "key",
    os: "windows",
    scope: { ...DEFAULT_BEACON_SCOPE, autoRunScripts: true, readRoots: [remoteDir], writeRoots: [remoteDir], ...scope },
    enabled: true,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  }
}

function patternBytes(size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(size).map((_, index) => (index * 17 + 3) % 253)
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function recordingTool(name: string, _description: string, _schema: object, handler: FakeTool["handler"]): FakeTool {
  return { name, handler }
}

function connectBeacon(handleRequest: (frame: Extract<BeaconFrame, { kind: "request" }>, reply: (frame: BeaconFrame) => void) => void) {
  const registry = createBeaconRegistry()
  const sent: BeaconFrame[] = []
  registry.connect({
    beaconId: BEACON_ID,
    beaconVersion: "1.0.0",
    protocolVersion: TRANSFER_PROTOCOL,
    scope: DEFAULT_BEACON_SCOPE,
    socket: {
      send(payload: SendPayload): number {
        const frame: BeaconFrame = JSON.parse(String(payload))
        sent.push(frame)
        if (frame.kind === "request") handleRequest(frame, (reply) => registry.routeInbound(BEACON_ID, reply))
        return sent.length
      },
    },
  })
  return { registry, sent }
}

function realBeaconMachine(config: BeaconConfig) {
  const transfer = createBeaconTransfer({
    kannaUrl: base,
    beaconVersion: "1.0.0",
    getReadRoots: () => config.scope.readRoots,
    getWriteRoots: () => config.scope.writeRoots,
    chunkBytes: CHUNK,
    keepAliveMs: 0,
    sleep: async () => undefined,
  })
  return connectBeacon((frame, reply) => {
    const { request } = frame
    let work: Promise<BeaconTransferResult>
    if (request.op === "upload") work = transfer.upload({ path: request.path, ticket: request.ticket })
    else if (request.op === "download") work = transfer.download({ ...request })
    else work = Promise.reject(new Error("unsupported"))
    work.then(
      (result) => reply({ kind: "result", id: frame.id, result }),
      (error) => reply({ kind: "error", id: frame.id, message: error instanceof Error ? error.message : String(error) }),
    )
  })
}

function toolsFor(
  registry: BeaconRegistry,
  config: BeaconConfig,
  options: { tickets?: BeaconTransferTickets; withProject?: boolean } = {},
): Map<string, FakeTool> {
  beacons = [config]
  const list = buildBeaconToolList(
    {
      beaconRegistry: registry,
      getBeacons: () => beacons,
      chatId: "chat-1",
      allowed: true,
      approval: { toolCallback, sessionId: "session-1", cwd: projectDir, chatPolicy: POLICY_DEFAULT },
      projectRoot: options.withProject === false ? undefined : projectDir,
      transferTickets: options.tickets,
    },
    recordingTool,
  )
  return new Map(list.map((entry) => [entry.name, entry]))
}

function textOf(result: ToolResult): string {
  return result.content[0].text
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 2000 && !condition(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  if (!condition()) throw new Error("condition was not reached")
}

describe("beacon_pull and beacon_push", () => {
  test("the transfer tools are offered only when the chat has a project root", () => {
    const { registry } = connectBeacon(() => undefined)
    const withProject = [...toolsFor(registry, beaconConfig({})).keys()]
    const without = [...toolsFor(registry, beaconConfig({}), { withProject: false }).keys()]

    expect(withProject).toContain("beacon_pull")
    expect(withProject).toContain("beacon_push")
    expect(without).not.toContain("beacon_pull")
    expect(without).not.toContain("beacon_push")
  })

  test("beacon_pull copies a multi-chunk file into the project, verified, and numbers a repeat", async () => {
    const bytes = patternBytes(CHUNK * 5 + 77)
    const remoteFile = path.join(remoteDir, "report.xlsx")
    await writeFile(remoteFile, bytes)
    const config = beaconConfig({})
    const { registry } = realBeaconMachine(config)
    const pull = toolsFor(registry, config).get("beacon_pull")!

    const first = await pull.handler({ beaconId: BEACON_ID, path: remoteFile })
    const second = await pull.handler({ beaconId: BEACON_ID, path: remoteFile })

    expect(first.isError).toBeUndefined()
    expect(textOf(first)).toContain(".kanna/uploads/report.xlsx")
    expect(textOf(first)).toContain(sha256(bytes))
    expect(textOf(second)).toContain(".kanna/uploads/report (1).xlsx")
    const uploads = path.join(projectDir, ".kanna", "uploads")
    expect(new Uint8Array(await readFile(path.join(uploads, "report.xlsx")))).toEqual(bytes)
    expect(new Uint8Array(await readFile(path.join(uploads, "report (1).xlsx")))).toEqual(bytes)
    expect((await readdir(uploads)).filter((name) => name.endsWith(".kanna-part"))).toEqual([])
  })

  test("beacon_push copies a multi-chunk project file to the beacon, verified", async () => {
    const bytes = patternBytes(CHUNK * 4 + 301)
    await writeFile(path.join(projectDir, "model.bin"), bytes)
    const config = beaconConfig({})
    const { registry } = realBeaconMachine(config)
    const push = toolsFor(registry, config).get("beacon_push")!
    const target = path.join(remoteDir, "inbox", "model.bin")

    const result = await push.handler({ beaconId: BEACON_ID, source: "model.bin", path: target })

    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toContain("model.bin")
    expect(textOf(result)).toContain(sha256(bytes))
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    expect((await readdir(path.dirname(target))).filter((name) => name.endsWith(".kanna-part"))).toEqual([])
  })

  test("beacon_push without overwrite refuses an existing file and leaves it untouched", async () => {
    await writeFile(path.join(projectDir, "new.bin"), patternBytes(CHUNK * 2))
    const existing = path.join(remoteDir, "keep.bin")
    await mkdir(remoteDir, { recursive: true })
    await writeFile(existing, "original")
    const config = beaconConfig({})
    const { registry } = realBeaconMachine(config)
    const push = toolsFor(registry, config).get("beacon_push")!

    const result = await push.handler({ beaconId: BEACON_ID, source: "new.bin", path: existing })

    expect(result.isError).toBe(true)
    expect(await readFile(existing, "utf8")).toBe("original")
    expect((await readdir(remoteDir)).filter((name) => name.endsWith(".kanna-part"))).toEqual([])
  })

  test("a transfer that moves no data fails after the idle timeout and revokes its ticket", async () => {
    let clock = 0
    const tickets = createBeaconTransferTickets({ now: () => clock, idleTimeoutMs: 1000 })
    const { registry, sent } = connectBeacon(() => undefined)
    const config = beaconConfig({})
    const pull = toolsFor(registry, config, { tickets }).get("beacon_pull")!

    const call = pull.handler({ beaconId: BEACON_ID, path: path.join(remoteDir, "stalled.bin") })
    await until(() => sent.some((frame) => frame.kind === "request"))
    const requestFrame = sent.find((frame) => frame.kind === "request")
    if (requestFrame?.kind !== "request" || requestFrame.request.op !== "upload") throw new Error("expected an upload request")
    const { ticket } = requestFrame.request
    clock += 2000
    tickets.sweep()
    const result = await call

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("idle timeout")
    expect(tickets.lookup(ticket, "upload")).toBeNull()
  })

  test("cancelling the call fails it and revokes the ticket", async () => {
    const tickets = createBeaconTransferTickets()
    const { registry, sent } = connectBeacon(() => undefined)
    const config = beaconConfig({})
    const pull = toolsFor(registry, config, { tickets }).get("beacon_pull")!
    const controller = new AbortController()

    const call = pull.handler({ beaconId: BEACON_ID, path: path.join(remoteDir, "cancelled.bin") }, { signal: controller.signal })
    await until(() => sent.some((frame) => frame.kind === "request"))
    const requestFrame = sent.find((frame) => frame.kind === "request")
    if (requestFrame?.kind !== "request" || requestFrame.request.op !== "upload") throw new Error("expected an upload request")
    controller.abort()
    const result = await call

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("cancelled")
    expect(tickets.lookup(requestFrame.request.ticket, "upload")).toBeNull()
  })
})
