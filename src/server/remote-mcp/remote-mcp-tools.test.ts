import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
import { startKannaServer } from "../server"

const PASSWORD = "secret"

const EXPECTED_TOOLS = [
  "answer_tool_request",
  "archive_chat",
  "cancel_chat",
  "check_package_updates",
  "checkout_branch",
  "comment_card",
  "commit_changes",
  "create_card",
  "create_chat",
  "create_project",
  "delete_chat",
  "enqueue_message",
  "fetch",
  "fork_chat",
  "get_background_task_output",
  "get_board",
  "get_chat",
  "get_git_status",
  "get_subagent_run",
  "get_update_status",
  "get_workflow_run",
  "kanna_command",
  "kanna_commands",
  "kanna_read",
  "list_boards",
  "list_branches",
  "list_chats",
  "list_cron_jobs",
  "list_installed_packages",
  "list_pending_tool_requests",
  "list_projects",
  "list_subagents",
  "list_workflows",
  "move_card",
  "open_project",
  "patch_app_settings",
  "pause_cron_job",
  "ping",
  "read_app_settings",
  "read_project_file",
  "remove_cron_job",
  "rename_chat",
  "respond_tool",
  "resume_cron_job",
  "search",
  "send_message",
  "server_info",
  "start_work_on_card",
  "sync_branch",
  "unarchive_chat",
  "upload_attachment",
]

let dataDir = ""
let projectDir = ""
let projectId = ""
let server: Awaited<ReturnType<typeof startKannaServer>>
let client: Client

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
    discoverProjects: () => [],
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

function arrayField(value: JsonValue | null, key: string): readonly JsonValue[] {
  const found = field(value, key)
  if (found === undefined || !isJsonArray(found)) throw new Error(`expected array field ${key}`)
  return found
}

async function newChat(): Promise<string> {
  return stringField((await call("create_chat", { projectId })).json, "chatId")
}

describe("remote MCP typed tools", () => {
  test("the server lists exactly the documented tools", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort()

    expect(names).toEqual([...EXPECTED_TOOLS].sort())
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

    const waited = await call("send_message", { chatId, content: "second prompt", timeoutSeconds: 20 })
    expect(field(waited.json, "status")).toBe("failed")
    expect(field(waited.json, "timedOut")).toBe(false)
    expect(field(waited.json, "pendingToolRequests")).toEqual([])

    expect((await call("send_message", { content: "no target" })).isError).toBe(true)
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

    const boards = await call("list_boards", { projectId })
    expect(JSON.stringify(boards.json)).toContain(boardId)

    const card = await call("create_card", { boardId, columnId: todo, title: "Write the tests" })
    const cardId = stringField(card.json, "id")
    expect(JSON.stringify((await call("get_board", { boardId })).json)).toContain("Write the tests")

    const moved = await call("move_card", { cardId, toColumnId: done })
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
        await call("checkout_branch", { chatId, name: "main" }),
        await call("sync_branch", { chatId, action: "fetch" }),
        await call("commit_changes", { chatId, paths: ["a.txt"], summary: "x" }),
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
})
