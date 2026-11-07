import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
import { startKannaServer } from "../server"
import { parkingClaudeSession, PARKED_QUESTION_ID, PARKED_QUESTIONS } from "../test-helpers/parking-claude-session"

const PASSWORD = "secret"

let dataDir = ""
let projectDir = ""
let server: Awaited<ReturnType<typeof startKannaServer>>
let client: Client
const session = parkingClaudeSession()

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-pending-data-"))
  projectDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-pending-project-"))
  server = await startKannaServer({
    dataDir,
    port: 0,
    strictPort: false,
    password: PASSWORD,
    trustProxy: false,
    discoverProjects: () => [],
    agentOverrides: { startClaudeSession: session.start },
  })
  client = new Client({ name: "pending-tools-test", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${PASSWORD}` } },
    }),
  )
})

afterAll(async () => {
  await client.close()
  await server.stop()
  await rm(dataDir, { recursive: true, force: true })
  await rm(projectDir, { recursive: true, force: true })
})

async function call(name: string, args: JsonObject): Promise<JsonValue | null> {
  const result = await client.callTool({ name, arguments: args })
  const first = Array.isArray(result.content) ? result.content[0] : undefined
  return first && first.type === "text" ? safeJsonParse(first.text) : null
}

function pendingOf(reply: JsonValue | null): JsonValue[] {
  const pending = reply !== null && isJsonObject(reply) ? reply.pending : undefined
  return Array.isArray(pending) ? pending : []
}

async function pendingCount(chatId: string, expected: number): Promise<JsonValue[]> {
  const deadline = Date.now() + 2000
  let pending = pendingOf(await call("list_pending_tool_requests", { chatId }))
  while (pending.length !== expected && Date.now() < deadline) {
    pending = pendingOf(await call("list_pending_tool_requests", { chatId }))
  }
  return pending
}

describe("remote MCP pending interactive tools", () => {
  test("list_pending_tool_requests drops an interactive tool once its parked slot is discarded", async () => {
    const projectId = (await server.store.openProject(projectDir, "Project")).id
    const created = await call("create_chat", { projectId })
    const chatId = created !== null && isJsonObject(created) && typeof created.chatId === "string" ? created.chatId : ""
    await call("send_message", { chatId, content: "ask me something", wait: false })

    expect(await pendingCount(chatId, 1)).toEqual([
      { kind: "interactive_tool", toolUseId: PARKED_QUESTION_ID, tool: "AskUserQuestion", input: { questions: PARKED_QUESTIONS } },
    ])

    session.crash()

    expect(await pendingCount(chatId, 0)).toEqual([])
  })
})
