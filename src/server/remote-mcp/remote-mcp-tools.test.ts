import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from "@modelcontextprotocol/client"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
import type { TranscriptEntry } from "../../shared/transcript-types"
import { COMMAND_REGISTRY } from "../../shared/commands"
import type { DiscoveredProject } from "../discovery.adapter"
import { startKannaServer } from "../server"
import { REMOTE_TOOLS } from "./remote-mcp-tool-table"
import { assistantText } from "./test-helpers/chat-snapshots"

const PASSWORD = "secret"

let dataDir = ""
let projectDir = ""
let projectId = ""
let server: Awaited<ReturnType<typeof startKannaServer>>
let client: Client
let discovered: DiscoveredProject[] = []

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-tools-data-"))
  projectDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-tools-project-"))
  await writeFile(path.join(projectDir, "hello.txt"), "hello world")
  await writeFile(path.join(projectDir, "blob.bin"), Buffer.from([1, 2, 0, 3]))
  server = await startKannaServer({
    dataDir,
    port: 0,
    strictPort: false,
    password: PASSWORD,
    trustProxy: false,
    discoverProjects: () => discovered,
    agentOverrides: { throwOnClaudeSessionStart: true },
  })
  projectId = (await server.store.openProject(projectDir, "Project")).id
  client = new Client({ name: "tools-test", version: "1.0.0" })
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

interface ToolReply {
  isError: boolean
  text: string
  json: JsonValue | null
}

async function call(name: string, args: JsonObject = {}): Promise<ToolReply> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content
  const first = Array.isArray(content) ? content[0] : undefined
  const text = first && first.type === "text" ? first.text : ""
  return { isError: result.isError === true, text, json: safeJsonParse(text) }
}

function field(value: JsonValue | null, key: string): JsonValue | undefined {
  return value !== null && isJsonObject(value) ? value[key] : undefined
}

function stringField(value: JsonValue | null, key: string): string {
  const found = field(value, key)
  if (typeof found !== "string") throw new Error(`expected string field ${key} in ${JSON.stringify(value)}`)
  return found
}

function commandRow(listing: ToolReply, type: string): JsonValue | null {
  const rows = listing.json !== null && isJsonArray(listing.json) ? listing.json : []
  return rows.find((row) => field(row, "type") === type) ?? null
}

function arrayField(value: JsonValue | null, key: string): readonly JsonValue[] {
  const found = field(value, key)
  if (found === undefined || !isJsonArray(found)) throw new Error(`expected array field ${key}`)
  return found
}

async function readAuditRecords(): Promise<JsonValue[]> {
  const text = await readFile(path.join(dataDir, "remote-mcp-calls.jsonl"), "utf8").catch(() => "")
  return text.split("\n").filter((line) => line.length > 0).map((line) => safeJsonParse(line) ?? null)
}

async function auditRecordWhere(matches: (entry: JsonValue) => boolean): Promise<JsonValue | undefined> {
  const deadline = Date.now() + 5000
  for (;;) {
    const found = (await readAuditRecords()).find(matches)
    if (found || Date.now() > deadline) return found
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function auditRecordFor(callId: string): Promise<JsonValue | undefined> {
  return auditRecordWhere((entry) => field(entry, "callId") === callId)
}

async function newChat(): Promise<string> {
  return stringField((await call("create_chat", { projectId })).json, "chatId")
}

describe("remote MCP typed tools", () => {
  test("the server registers exactly the tools of the tool table, each exposing every param of its command", async () => {
    const listed = (await client.listTools()).tools

    expect(listed.map((tool) => tool.name).sort()).toEqual(REMOTE_TOOLS.map((tool) => tool.name).sort())
    for (const tool of REMOTE_TOOLS) {
      if (tool.backing.kind !== "command") continue
      const { command, hidden } = tool.backing
      const served = listed.find((entry) => entry.name === tool.name)
      const properties = Object.keys(served?.inputSchema.properties ?? {})
      const params = Object.keys(COMMAND_REGISTRY.find((definition) => definition.type === command)?.params.shape ?? {})
      expect(properties).toEqual(expect.arrayContaining(params.filter((param) => !(param in hidden))))
    }
  })

  test("projects and chats can be listed, created, renamed, found and fetched", async () => {
    const listed = await call("list_projects")
    const project = arrayField(listed.json, "projects").find((row) => field(row, "projectId") === projectId)
    expect(project && field(project, "localPath")).toBe(projectDir)
    expect(project && field(project, "title")).toBe("Project")

    const chatId = await newChat()
    const chats = await call("list_chats", { projectId })
    expect(arrayField(chats.json, "chats").some((row) => field(row, "chatId") === chatId)).toBe(true)

    expect((await call("rename_chat", { chatId, title: "Renamed by MCP" })).isError).toBe(false)
    expect(stringField((await call("get_chat", { chatId })).json, "title")).toBe("Renamed by MCP")

    const found = await call("search", { query: "renamed by" })
    expect(arrayField(found.json, "results").map((row) => field(row, "id"))).toContain(`chat:${chatId}`)
    const byProject = await call("search", { query: "Project" })
    expect(arrayField(byProject.json, "results").map((row) => field(row, "id"))).toContain(`project:${projectId}`)

    const fetched = await call("fetch", { id: `chat:${chatId}` })
    expect(stringField(fetched.json, "title")).toBe("Renamed by MCP")
    expect(stringField(fetched.json, "url")).toBe(`kanna://chats/${chatId}`)
    const fetchedProject = await call("fetch", { id: `project:${projectId}` })
    expect(stringField(fetchedProject.json, "text")).toContain(projectDir)
    expect((await call("fetch", { id: "nonsense" })).isError).toBe(true)
  })

  test("archive, unarchive, fork and delete move a chat through its lifecycle", async () => {
    const chatId = await newChat()

    await call("archive_chat", { chatId })
    const active = await call("list_chats", { projectId })
    expect(arrayField(active.json, "chats").some((row) => field(row, "chatId") === chatId)).toBe(false)
    const withArchived = await call("list_chats", { projectId, includeArchived: true })
    expect(arrayField(withArchived.json, "chats").some((row) => field(row, "chatId") === chatId && field(row, "archived") === true)).toBe(true)

    await call("unarchive_chat", { chatId })
    expect(arrayField((await call("list_chats", { projectId })).json, "chats").some((row) => field(row, "chatId") === chatId)).toBe(true)

    await call("delete_chat", { chatId })
    expect((await call("get_chat", { chatId })).isError).toBe(true)
  })

  test("send_message without waiting records the prompt, and waiting reports the failed turn", async () => {
    const chatId = await newChat()

    const sent = await call("send_message", { chatId, content: "first prompt", wait: false })
    expect(stringField(sent.json, "chatId")).toBe(chatId)
    const chat = await call("get_chat", { chatId })
    const prompts = arrayField(chat.json, "entries").filter((entry) => field(entry, "kind") === "user_prompt")
    expect(prompts.map((entry) => field(entry, "text"))).toContain("first prompt")

    expect(field((await call("wait_for_chat", { chatId, timeoutSeconds: 40 })).json, "done")).toBe(true)

    const waited = await call("send_message", { chatId, content: "second prompt", timeoutSeconds: 40 })
    expect(field(waited.json, "status")).toBe("failed")
    expect(field(waited.json, "done")).toBe(true)
    expect(field(waited.json, "timedOut")).toBe(false)
    expect(field(waited.json, "pendingToolRequests")).toEqual([])

    expect((await call("send_message", { content: "no target" })).isError).toBe(true)
  }, 60_000)

  test("send_message reports whether the turn is done and where to follow it, and wait_for_chat returns only what is newer than the cursor", async () => {
    const chatId = await newChat()

    const reply = await call("send_message", { chatId, content: "first request", timeoutSeconds: 25 })

    expect(field(reply.json, "done")).toBe(true)
    expect(field(reply.json, "status")).toBe("failed")
    expect(field(reply.json, "busy")).toBe(false)
    expect(arrayField(reply.json, "activity").length).toBeGreaterThan(0)
    expect(stringField(reply.json, "next").length).toBeGreaterThan(0)
    const cursor = field(reply.json, "cursor")
    if (typeof cursor !== "number") throw new Error("expected a numeric cursor")
    const latest = await call("wait_for_chat", { chatId, timeoutSeconds: 25 })
    const nothingNew = await call("wait_for_chat", { chatId, cursor, timeoutSeconds: 25 })
    expect(JSON.stringify(field(latest.json, "activity"))).toContain("first request")
    expect(field(nothingNew.json, "activity")).toEqual([])
    expect(field(nothingNew.json, "done")).toBe(true)
    expect((await call("wait_for_chat", { chatId: "missing" })).isError).toBe(true)
  }, 60_000)

  test("a client that asks for progress receives notifications while the turn runs", async () => {
    const sent = await call("send_message", { projectId, content: "progress please", wait: false })
    const chatId = stringField(sent.json, "chatId")
    const messages: string[] = []

    const result = await client.callTool(
      { name: "wait_for_chat", arguments: { chatId, timeoutSeconds: 25 } },
      undefined,
      { onprogress: (progress) => messages.push(progress.message ?? "") },
    )

    expect(result.isError).toBeFalsy()
    expect(messages.length).toBeGreaterThan(0)
  }, 60_000)

  test("a 2026-07-28 client that asks for progress also receives notifications while the turn runs", async () => {
    const modern = new ModernClient({ name: "modern-tools-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } })
    await modern.connect(
      new ModernTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${PASSWORD}` } } }),
    )
    try {
      expect(modern.getProtocolEra()).toBe("modern")
      const sent = await call("send_message", { projectId, content: "progress for the modern era", wait: false })
      const chatId = stringField(sent.json, "chatId")
      const messages: string[] = []

      const result = await modern.callTool(
        { name: "wait_for_chat", arguments: { chatId, timeoutSeconds: 25 } },
        { onprogress: (progress) => messages.push(progress.message ?? "") },
      )

      expect(result.isError).toBeFalsy()
      expect(messages.length).toBeGreaterThan(0)
    } finally {
      await modern.close()
    }
  }, 60_000)

  test("a repeated send_message with the same idempotencyKey returns the original chat and starts no new one", async () => {
    const before = arrayField((await call("list_chats", { projectId })).json, "chats").length

    const first = await call("send_message", { projectId, content: "only once", idempotencyKey: "request-1", wait: false })
    const second = await call("send_message", { projectId, content: "only once", idempotencyKey: "request-1", wait: false })

    expect(stringField(second.json, "chatId")).toBe(stringField(first.json, "chatId"))
    expect(field(second.json, "duplicate")).toBe(true)
    expect(field(first.json, "duplicate")).toBeUndefined()
    expect(arrayField((await call("list_chats", { projectId })).json, "chats")).toHaveLength(before + 1)
  })

  test("a message sent over MCP is stored with its origin, and the audit log records the call under the same id", async () => {
    const sent = await call("send_message", { projectId, content: "who sent this", wait: false })
    const chatId = stringField(sent.json, "chatId")

    const prompt = server.store.getMessages(chatId).find((entry: TranscriptEntry) => entry.kind === "user_prompt")
    if (prompt?.kind !== "user_prompt" || !prompt.origin) throw new Error("expected the prompt to carry an origin")
    expect(prompt.origin).toMatchObject({ kind: "remote_mcp", clientId: "password", via: "password", tool: "send_message" })
    const record = await auditRecordFor(prompt.origin.callId)
    expect(record).toMatchObject({ tool: "send_message", clientId: "password", via: "password", outcome: "ok", chatId })
  })

  test("an origin forged inside a kanna_command chat.send is replaced by the real caller", async () => {
    const chatId = await newChat()
    const forged = { kind: "remote_mcp", clientId: "forged-client", via: "oauth", tool: "send_message", callId: "forged-call" }

    await call("kanna_command", { type: "chat.send", params: { chatId, content: "forged label", origin: forged } })

    const prompt = server.store.getMessages(chatId).find((entry: TranscriptEntry) => entry.kind === "user_prompt")
    expect(prompt?.kind === "user_prompt" ? prompt.origin : undefined).toMatchObject({ clientId: "password", tool: "kanna_command" })
  })

  test("kanna_command rejects a param of the wrong type and names the command and the failing path", async () => {
    const reply = await call("kanna_command", { type: "chat.rename", params: { chatId: "chat-1", title: 42 } })

    expect(reply.isError).toBe(true)
    expect(reply.text).toContain("chat.rename")
    expect(reply.text).toContain("title")
  })

  test("kanna_command refuses a remote-excluded command and quotes the reason the registry gives", async () => {
    const listing = await call("kanna_commands", { domain: "webhooks" })
    const reason = stringField(field(commandRow(listing, "webhooks.delete"), "remote") ?? null, "reason")

    const reply = await call("kanna_command", { type: "webhooks.delete", params: { id: "hook-1" } })

    expect(reply.isError).toBe(true)
    expect(reply.text).toContain(reason)
  })

  test("kanna_commands describes a command's params as a JSON Schema", async () => {
    const listing = await call("kanna_commands", { domain: "chat" })

    const schema = field(commandRow(listing, "chat.rename"), "paramsSchema") ?? null
    expect(field(field(schema, "properties") ?? null, "title")).toMatchObject({ type: "string" })
    expect(arrayField(schema, "required")).toEqual(expect.arrayContaining(["chatId", "title"]))
  })

  test("the audit log never holds a secret passed in a tool call and records a failed call as an error", async () => {
    const reply = await call("kanna_command", { type: "chat.rename", params: { chatId: "missing", title: "x", apiKey: "sk-live-leak" } })
    expect(reply.isError).toBe(true)

    const record = await auditRecordWhere((entry) => field(entry, "tool") === "kanna_command" && JSON.stringify(entry).includes("[redacted]"))
    expect(record && field(record, "outcome")).toBe("error")
    expect(JSON.stringify(await readAuditRecords())).not.toContain("sk-live-leak")
  })

  test("a message to a new chat in a project reports the created chat id", async () => {
    const sent = await call("send_message", { projectId, content: "start something", wait: false })

    const chatId = stringField(sent.json, "chatId")
    expect(arrayField((await call("list_chats", { projectId })).json, "chats").some((row) => field(row, "chatId") === chatId)).toBe(true)
  })

  test("pending tool requests and git status answer for a chat without any", async () => {
    const chatId = await newChat()

    const pending = await call("list_pending_tool_requests", { chatId })
    expect(field(pending.json, "pending")).toEqual([])

    const git = await call("get_git_status", { chatId })
    expect(field(git.json, "status")).toBe("no_repo")
    expect(field(git.json, "files")).toEqual([])
  })

  test("a board's cards can be created, moved and commented through typed tools", async () => {
    const board = await call("kanna_command", { type: "board.create", params: { ownerKind: "project", ownerId: projectId, title: "Work" } })
    const boardId = stringField(board.json, "id")
    const todo = stringField((await call("kanna_command", { type: "board.column.create", params: { boardId, title: "Todo" } })).json, "id")
    const done = stringField((await call("kanna_command", { type: "board.column.create", params: { boardId, title: "Done" } })).json, "id")

    const boards = await call("list_boards", { ownerId: projectId })
    expect(JSON.stringify(boards.json)).toContain(boardId)

    const card = await call("create_card", { boardId, columnId: todo, title: "Write the tests" })
    const cardId = stringField(card.json, "id")
    expect(JSON.stringify((await call("get_board", { boardId })).json)).toContain("Write the tests")

    const moved = await call("move_card", { cardId, toColumnId: done, aboveCardId: null, belowCardId: null })
    expect(moved.isError).toBe(false)
    expect(field(moved.json, "columnId")).toBe(done)

    const commented = await call("comment_card", { cardId, body: "looks good" })
    expect(commented.isError).toBe(false)
    expect(field(commented.json, "cardId")).toBe(cardId)
    expect(field(commented.json, "body")).toBe("looks good")
  })

  test("app settings are read with secrets redacted and a patch round-trips", async () => {
    await server.appSettings.writePatch({ claudeAuth: { tokens: [{
      id: "t1",
      label: "main",
      token: "sk-ant-oat-secret-value",
      status: "active",
      limitedUntil: null,
      lastUsedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      addedAt: 0,
    }] } })

    const settings = await call("read_app_settings")
    expect(settings.text).not.toContain("sk-ant-oat-secret-value")
    expect(field(settings.json, "theme")).toBeDefined()

    const patched = await call("patch_app_settings", { patch: { remoteMcp: { publicUrl: "https://example.com/ignored" } } })
    expect(patched.isError).toBe(false)
    expect(field(field(patched.json, "remoteMcp") ?? null, "publicUrl")).toBe("https://example.com")
    expect(server.appSettings.getSnapshot().remoteMcp.publicUrl).toBe("https://example.com")
    await call("patch_app_settings", { patch: { remoteMcp: { publicUrl: null } } })

    expect(Array.isArray(arrayField((await call("list_subagents")).json, "subagents"))).toBe(true)
    expect((await call("list_installed_packages")).isError).toBe(false)
  })

  test("a typed tool rejects a nested value that breaks the command schema and leaves the setting unchanged", async () => {
    const before = server.appSettings.getSnapshot().analyticsEnabled

    const rejected = await call("patch_app_settings", { patch: { analyticsEnabled: "yes" } })

    expect(rejected.isError).toBe(true)
    expect(rejected.text).toContain("analyticsEnabled")
    expect(server.appSettings.getSnapshot().analyticsEnabled).toBe(before)
  })

  test("kanna_read app-settings does not return a raw Claude OAuth token or MCP server secret", async () => {
    await server.appSettings.writePatch({ claudeAuth: { tokens: [{
      id: "t-egress",
      label: "egress-token",
      token: "sk-ant-oat-egress-leak",
      status: "active",
      limitedUntil: null,
      lastUsedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      addedAt: 0,
    }] } })
    await server.appSettings.writePatch({ customMcpServers: { create: {
      name: "egress-http",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer header-egress-leak" },
    } } })
    await server.appSettings.writePatch({ customMcpServers: { create: {
      name: "egress-stdio",
      transport: "stdio",
      command: "echo",
      args: [],
      env: { API_TOKEN: "env-egress-leak" },
    } } })

    const read = await call("kanna_read", { topic: { type: "app-settings" } })
    const viaCommand = await call("kanna_command", { type: "settings.readAppSettings" })

    for (const reply of [read, viaCommand]) {
      expect(reply.isError).toBe(false)
      expect(reply.text).not.toContain("sk-ant-oat-egress-leak")
      expect(reply.text).not.toContain("header-egress-leak")
      expect(reply.text).not.toContain("env-egress-leak")
      expect(reply.text).toContain("egress-token")
      expect(reply.text).toContain("egress-http")
    }
  })

  test("files can be uploaded and read, and the project root is enforced", async () => {
    const uploaded = await call("upload_attachment", {
      projectId,
      fileName: "notes.txt",
      contentBase64: Buffer.from("uploaded text").toString("base64"),
      contentType: "text/plain",
    })
    const attachment = arrayField(uploaded.json, "attachments")[0]
    const absolutePath = attachment ? field(attachment, "absolutePath") : undefined
    expect(typeof absolutePath === "string" && (await readFile(absolutePath, "utf8"))).toBe("uploaded text")

    const text = await call("read_project_file", { projectId, path: "hello.txt" })
    expect(field(text.json, "text")).toBe("hello world")
    expect(field(text.json, "truncated")).toBe(false)

    const truncated = await call("read_project_file", { projectId, path: "hello.txt", maxBytes: 5 })
    expect(field(truncated.json, "text")).toBe("hello")
    expect(field(truncated.json, "truncated")).toBe(true)

    const binary = await call("read_project_file", { projectId, path: "blob.bin" })
    expect(field(binary.json, "base64")).toBe(Buffer.from([1, 2, 0, 3]).toString("base64"))

    expect((await call("read_project_file", { projectId, path: "../outside.txt" })).isError).toBe(true)
    expect((await call("read_project_file", { projectId, path: "/etc/passwd" })).isError).toBe(true)
    expect((await call("read_project_file", { projectId, path: "missing.txt" })).isError).toBe(true)
    expect((await call("upload_attachment", { projectId: "nope", fileName: "a", contentBase64: "" })).isError).toBe(true)
  })

  test("a symlink inside the project cannot be used to read outside it", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "kanna-remote-tools-outside-"))
    try {
      await writeFile(path.join(outside, "secret.txt"), "outside secret")
      await symlink(outside, path.join(projectDir, "link"))

      const reply = await call("read_project_file", { projectId, path: "link/secret.txt" })

      expect(reply.text).not.toContain("outside secret")
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test("cron, update and server info answer with JSON", async () => {
    expect(field((await call("list_cron_jobs")).json, "type")).toBe("cron-jobs")
    expect(field((await call("get_update_status")).json, "type")).toBe("update")
    const info = await call("server_info")
    expect(stringField(info.json, "version").length).toBeGreaterThan(0)
    expect(stringField(info.json, "publicOrigin")).toBe(`http://127.0.0.1:${server.port}`)
    expect(typeof stringField(info.json, "machineName")).toBe("string")
  })

  test("workflow and background-task reads answer for a chat that has none", async () => {
    const chatId = await newChat()

    expect(field((await call("list_workflows", { chatId })).json, "type")).toBe("workflows")
    const output = await call("get_background_task_output", { chatId, taskId: "none" })
    expect(output.isError).toBe(false)
    expect(JSON.stringify(output.json)).toContain("background-task-output")
  })

  test("the board resource template reads a board", async () => {
    const board = await call("kanna_command", { type: "board.create", params: { ownerKind: "project", ownerId: projectId, title: "Resource board" } })
    const boardId = stringField(board.json, "id")

    const read = await client.readResource({ uri: `kanna://boards/${boardId}` })

    const content = read.contents[0]
    expect(content && "text" in content ? content.text : "").toContain(boardId)
  })

  test("less-travelled tools reach their commands and relay the server's answers", async () => {
    const chatId = await newChat()
    const extra = await mkdtemp(path.join(tmpdir(), "kanna-remote-tools-extra-"))
    try {
      const opened = await call("open_project", { localPath: extra })
      expect(stringField(opened.json, "projectId").length).toBeGreaterThan(0)
      const created = await call("create_project", { localPath: path.join(extra, "child"), title: "Child" })
      const createdId = stringField(created.json, "projectId")
      expect(JSON.stringify((await call("list_projects")).json)).toContain(createdId)

      expect(stringField((await call("enqueue_message", { chatId, content: "later" })).json, "queuedMessageId").length).toBeGreaterThan(0)
      expect((await call("cancel_chat", { chatId })).isError).toBe(false)
      expect((await call("pause_cron_job", { chatId, jobId: "none" })).isError).toBe(false)
      expect((await call("resume_cron_job", { chatId, jobId: "none" })).isError).toBe(false)
      expect((await call("remove_cron_job", { chatId, jobId: "none" })).isError).toBe(false)

      expect((await call("fork_chat", { chatId })).text).toContain("provider")
      for (const reply of [
        await call("list_branches", { chatId }),
        await call("checkout_branch", { chatId, branch: { kind: "local", name: "main" } }),
        await call("sync_branch", { chatId, action: "fetch" }),
        await call("commit_changes", { chatId, paths: ["a.txt"], summary: "x", mode: "commit_only" }),
      ]) {
        expect(reply.isError).toBe(true)
        expect(reply.text).toContain("git repository")
      }

      const answered = await call("answer_tool_request", { chatId, toolRequestId: "none", decision: { kind: "deny" } })
      expect(answered.isError).toBe(true)
      expect((await call("respond_tool", { chatId, toolUseId: "none", result: "x" })).text).toContain("No pending tool request")
      expect((await call("get_workflow_run", { chatId, runId: "none" })).text).toBe("null")
      expect((await call("get_subagent_run", { chatId, agentId: "none" })).text).toBe("[]")
      expect((await call("start_work_on_card", { cardId: "none" })).isError).toBe(true)
    } finally {
      await rm(extra, { recursive: true, force: true })
    }
  })
  test("send_message carries the model options of the send command through to the chat", async () => {
    const chatId = await newChat()
    const modelOptions = { claude: { reasoningEffort: "high", contextWindow: "1m" } } as const

    await call("send_message", { chatId, content: "tuned", model: "claude-opus-4-1", modelOptions, effort: "high", autoResumeOnRateLimit: true, wait: false })

    expect(server.store.getChat(chatId)?.modelOptions).toEqual(modelOptions)
  })

  test("enqueue_message keeps the model, plan mode and attachments of the queued command", async () => {
    const chatId = await newChat()

    const queued = await call("enqueue_message", { chatId, content: "later with options", model: "claude-opus-4-1", planMode: true })

    const message = server.store.getQueuedMessages(chatId).find((entry) => entry.id === field(queued.json, "queuedMessageId"))
    expect(message).toMatchObject({ content: "later with options", model: "claude-opus-4-1", planMode: true })
  })

  test("move_card places a card between the neighbours it names", async () => {
    const boardId = stringField((await call("kanna_command", { type: "board.create", params: { ownerKind: "project", ownerId: projectId, title: "Order" } })).json, "id")
    const column = stringField((await call("kanna_command", { type: "board.column.create", params: { boardId, title: "Queue" } })).json, "id")
    const bottom = stringField((await call("create_card", { boardId, columnId: column, title: "bottom" })).json, "id")
    const middle = stringField((await call("create_card", { boardId, columnId: column, title: "middle" })).json, "id")
    const top = stringField((await call("create_card", { boardId, columnId: column, title: "top" })).json, "id")

    const moved = await call("move_card", { cardId: bottom, toColumnId: column, aboveCardId: top, belowCardId: middle })

    expect(moved.isError).toBe(false)
    const board = await call("get_board", { boardId })
    const cards = field(field(field(board.json, "data") ?? null, "view") ?? null, "cards") ?? null
    expect(arrayField(cards, column).map((card) => field(card, "title"))).toEqual(["top", "bottom", "middle"])
  })

  test("checkout_branch accepts a remote branch ref and rejects one without its remoteRef", async () => {
    const chatId = await newChat()

    const remote = await call("checkout_branch", { chatId, branch: { kind: "remote", name: "origin/feature", remoteRef: "refs/remotes/origin/feature" } })
    const incomplete = await call("checkout_branch", { chatId, branch: { kind: "remote", name: "origin/feature" } })

    expect(remote.text).toContain("git repository")
    expect(incomplete.isError).toBe(true)
    expect(incomplete.text).toContain("remoteRef")
  })

  test("typed tools still accept their v1.85 inputs", async () => {
    const rejectedForInput = (reply: ToolReply) => reply.isError && reply.text.startsWith("Input validation error")
    const boardId = stringField((await call("kanna_command", { type: "board.create", params: { ownerKind: "project", ownerId: projectId, title: "Legacy" } })).json, "id")
    const column = stringField((await call("kanna_command", { type: "board.column.create", params: { boardId, title: "Queue" } })).json, "id")
    const first = stringField((await call("create_card", { boardId, columnId: column, title: "first" })).json, "id")
    const second = stringField((await call("create_card", { boardId, columnId: column, title: "second" })).json, "id")
    const chatId = await newChat()

    const boards = await call("list_boards", { projectId })
    const checkout = await call("checkout_branch", { chatId, name: "main" })
    const commit = await call("commit_changes", { chatId, paths: ["hello.txt"], summary: "legacy" })
    const moved = await call("move_card", { cardId: first, toColumnId: column })

    expect(boards.isError).toBe(false)
    expect(JSON.stringify(boards.json)).toContain(boardId)
    expect(rejectedForInput(checkout)).toBe(false)
    expect(checkout.text).toContain("git repository")
    expect(rejectedForInput(commit)).toBe(false)
    expect(commit.text).toContain("git repository")
    expect(moved.isError).toBe(false)
    const cards = field(field(field((await call("get_board", { boardId })).json, "data") ?? null, "view") ?? null, "cards") ?? null
    expect(arrayField(cards, column).map((card) => field(card, "id"))).toEqual([second, first])

    const ambiguousOwner = await call("list_boards", { projectId, ownerId: projectId })
    const ambiguousBranch = await call("checkout_branch", { chatId, name: "main", branch: { kind: "local", name: "main" } })
    expect(rejectedForInput(ambiguousOwner)).toBe(true)
    expect(ambiguousOwner.text).toContain("projectId")
    expect(rejectedForInput(ambiguousBranch)).toBe(true)
    expect(ambiguousBranch.text).toContain("name")
  })

  test("kanna_command chat.send with the same idempotencyKey starts one turn", async () => {
    const params = { projectId, content: "send through the generic command once" }

    const first = await call("kanna_command", { type: "chat.send", params, idempotencyKey: "generic-send-1" })
    const second = await call("kanna_command", { type: "chat.send", params, idempotencyKey: "generic-send-1" })

    const chatId = stringField(first.json, "chatId")
    expect(stringField(second.json, "chatId")).toBe(chatId)
    expect(field(second.json, "duplicate")).toBe(true)
    expect(server.store.getMessages(chatId).filter((entry: TranscriptEntry) => entry.kind === "user_prompt")).toHaveLength(1)
  })

  test("kanna_command message.enqueue with the same idempotencyKey queues one message", async () => {
    const chatId = await newChat()
    const params = { chatId, content: "queue once through the generic command" }

    await call("kanna_command", { type: "message.enqueue", params, idempotencyKey: "generic-enqueue-1" })
    const second = await call("kanna_command", { type: "message.enqueue", params, idempotencyKey: "generic-enqueue-1" })

    expect(field(second.json, "duplicate")).toBe(true)
    expect(server.store.getQueuedMessages(chatId)).toHaveLength(1)
  })

  test("get_chat pages back through older entries with the cursor it reports", async () => {
    const chatId = await newChat()
    for (let at = 1; at <= 5; at += 1) await server.store.appendMessage(chatId, assistantText(at, `entry ${at}`))

    const newest = await call("get_chat", { chatId, limit: 2 })
    expect(field(newest.json, "hasOlder")).toBe(true)
    const older = await call("get_chat", { chatId, limit: 2, beforeCursor: stringField(newest.json, "olderCursor") })
    const oldest = await call("get_chat", { chatId, limit: 2, beforeCursor: stringField(older.json, "olderCursor") })

    const texts = (reply: ToolReply) => arrayField(reply.json, "entries").map((entry) => field(entry, "text"))
    expect(texts(newest)).toEqual(["entry 4", "entry 5"])
    expect(texts(older)).toEqual(["entry 2", "entry 3"])
    expect(texts(oldest)).toEqual(["entry 1"])
    expect(field(oldest.json, "hasOlder")).toBe(false)
  })

  test("kanna_read of local-projects runs the project discovery the web subscription runs", async () => {
    const found = await mkdtemp(path.join(tmpdir(), "kanna-remote-tools-discovered-"))
    try {
      discovered = [{ localPath: found, title: "Discovered", modifiedAt: 1, discoveredByProviders: ["claude"] }]

      const read = await call("kanna_read", { topic: { type: "local-projects" } })

      expect(read.text).toContain(found)
    } finally {
      discovered = []
      await rm(found, { recursive: true, force: true })
    }
  })
})
