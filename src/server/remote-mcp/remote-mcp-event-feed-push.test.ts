import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from "@modelcontextprotocol/client"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonObject } from "../../shared/json"
import { namedBusSubject } from "../../shared/service-bus/subjects"
import { startKannaServer } from "../server"
import { finishingClaudeSession } from "../test-helpers/finishing-claude-session"
import { parkingClaudeSession } from "../test-helpers/parking-claude-session"
import { chatResourceUri, EVENTS_RESOURCE_URI } from "./remote-mcp-resources"

const PASSWORD = "secret"
const POLL_DEADLINE_MS = 8000
const TEST_TIMEOUT_MS = 30_000

type StartSession = NonNullable<Parameters<typeof startKannaServer>[0]>["agentOverrides"]

interface Harness {
  client: ModernClient
  notified: (uri: string) => Promise<void>
  chatId: string
  stop: () => Promise<void>
}

const stops: Array<() => Promise<void>> = []

afterEach(async () => {
  while (stops.length > 0) await stops.pop()?.()
})

type ToolResult = Awaited<ReturnType<ModernClient["callTool"]>>
type ResourceResult = Awaited<ReturnType<ModernClient["readResource"]>>

function toolText(result: ToolResult): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? first.text : ""
}

function resourceText(result: ResourceResult): string {
  const first = result.contents[0]
  return first !== undefined && "text" in first ? first.text : ""
}

function pageOf(text: string): { cursor: string; reset: boolean; dropped: number; subjects: Array<{ subject: string; chatId: string | undefined }> } {
  const parsed = safeJsonParse(text)
  if (parsed === null || !isJsonObject(parsed)) throw new Error(`not a feed page: ${text}`)
  const events = isJsonArray(parsed.events) ? parsed.events : []
  return {
    cursor: typeof parsed.cursor === "string" ? parsed.cursor : "",
    reset: parsed.reset === true,
    dropped: typeof parsed.dropped === "number" ? parsed.dropped : -1,
    subjects: events.flatMap((event) => {
      const envelope = isJsonObject(event) ? (event.envelope ?? null) : null
      if (!isJsonObject(envelope) || typeof envelope.subject !== "string") return []
      return [{ subject: envelope.subject, chatId: typeof envelope.chatId === "string" ? envelope.chatId : undefined }]
    }),
  }
}

async function start(agentOverrides: StartSession): Promise<Harness> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-event-feed-data-"))
  const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-event-feed-project-"))
  const server = await startKannaServer({ dataDir, port: 0, strictPort: false, password: PASSWORD, trustProxy: false, discoverProjects: () => [], agentOverrides })
  const client = new ModernClient({ name: "event-feed-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } })
  await client.connect(
    new ModernTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${PASSWORD}` } } }),
  )
  const arrivals = new Map<string, Promise<void>>()
  const resolvers = new Map<string, () => void>()
  const notified = (uri: string) => {
    const existing = arrivals.get(uri)
    if (existing) return existing
    const arrival = new Promise<void>((resolve) => resolvers.set(uri, resolve))
    arrivals.set(uri, arrival)
    return arrival
  }
  client.setNotificationHandler("notifications/resources/updated", (notification) => {
    void notified(notification.params.uri)
    resolvers.get(notification.params.uri)?.()
  })
  const projectId = (await server.store.openProject(projectDir, "Project")).id
  const created = safeJsonParse(toolText(await client.callTool({ name: "create_chat", arguments: { projectId } })))
  const chatId = created !== null && isJsonObject(created) && typeof created.chatId === "string" ? created.chatId : ""
  const harness: Harness = {
    client,
    notified,
    chatId,
    stop: async () => {
      await client.close()
      await server.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(projectDir, { recursive: true, force: true })
    },
  }
  stops.push(harness.stop)
  return harness
}

async function readEvents(client: ModernClient, uri: string) {
  return pageOf(resourceText(await client.readResource({ uri })))
}

async function waitForSubject(client: ModernClient, after: string, subject: string) {
  const deadline = Date.now() + POLL_DEADLINE_MS
  let page = await readEvents(client, `${EVENTS_RESOURCE_URI}?after=${after}`)
  while (!page.subjects.some((event) => event.subject === subject) && Date.now() < deadline) {
    page = await readEvents(client, `${EVENTS_RESOURCE_URI}?after=${after}`)
  }
  return page
}

function callArgs(name: string, args: JsonObject) {
  return { name, arguments: args }
}

describe("remote MCP event feed", () => {
  test("a listening modern client is pushed an update when a turn finishes, and reads the finished turn after its cursor", async () => {
    const harness = await start({ startClaudeSession: finishingClaudeSession() })
    const { client, chatId } = harness
    const before = await readEvents(client, EVENTS_RESOURCE_URI)
    const subscription = await client.listen({ resourceSubscriptions: [EVENTS_RESOURCE_URI, chatResourceUri(chatId)] })

    await client.callTool(callArgs("send_message", { chatId, content: "hello", wait: false }))
    const page = await waitForSubject(client, before.cursor, namedBusSubject("turnFinished"))
    await Promise.all([harness.notified(EVENTS_RESOURCE_URI), harness.notified(chatResourceUri(chatId))])

    expect(page.subjects).toContainEqual({ subject: namedBusSubject("turnFinished"), chatId })
    const drained = await readEvents(client, `${EVENTS_RESOURCE_URI}?after=${page.cursor}`)
    expect(drained.subjects).toEqual([])
    expect(drained.cursor).toBe(page.cursor)
    await subscription.close()
  }, TEST_TIMEOUT_MS)

  test("a cursor from another boot is reset", async () => {
    const harness = await start({ startClaudeSession: finishingClaudeSession() })

    const page = await readEvents(harness.client, `${EVENTS_RESOURCE_URI}?after=${"another-boot:7"}`)

    expect(page.reset).toBe(true)
    expect(page.dropped).toBe(0)
  })

  test("wait_for_events resolves with the event that arrives, and a parked question is a kanna.chat.toolPending event", async () => {
    const parking = parkingClaudeSession()
    const harness = await start({ startClaudeSession: parking.start })
    const { client, chatId } = harness
    const before = await readEvents(client, EVENTS_RESOURCE_URI)

    const waiting = client.callTool(callArgs("wait_for_events", { after: before.cursor, timeoutSeconds: 30 }))
    await client.callTool(callArgs("send_message", { chatId, content: "ask me something", wait: false }))
    const first = pageOf(toolText(await waiting))

    expect(first.subjects.length).toBeGreaterThan(0)
    expect(first.subjects.every((event) => event.chatId === chatId)).toBe(true)
    const pending = await waitForSubject(client, before.cursor, namedBusSubject("chatToolPending"))
    expect(pending.subjects).toContainEqual({ subject: namedBusSubject("chatToolPending"), chatId })
    parking.crash()
  }, TEST_TIMEOUT_MS)
})
