import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { COMMAND_REGISTRY, isCommandType, remotePolicyOf } from "../../shared/commands"
import { HTTP_ROUTES, listHttpRoutes, matchRoutePath } from "../../shared/http-routes"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
import { startKannaServer } from "../server"

const PASSWORD = "secret"

let dataDir = ""
let projectDir = ""
let projectId = ""
let server: Awaited<ReturnType<typeof startKannaServer>>
let client: Client

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-parity-data-"))
  projectDir = await mkdtemp(path.join(tmpdir(), "kanna-parity-project-"))
  await writeFile(path.join(projectDir, "hello.txt"), "hello world")
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
  client = new Client({ name: "parity-test", version: "1.0.0" })
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
}, 30_000)

interface ToolReply {
  isError: boolean
  text: string
  json: JsonValue | null
}

async function call(name: string, args: JsonObject = {}): Promise<ToolReply> {
  const result = await client.callTool({ name, arguments: args })
  const first = Array.isArray(result.content) ? result.content[0] : undefined
  const text = first && first.type === "text" ? first.text : ""
  return { isError: result.isError === true, text, json: safeJsonParse(text) }
}

function field(value: JsonValue | null | undefined, key: string): JsonValue | undefined {
  return value !== null && value !== undefined && isJsonObject(value) ? value[key] : undefined
}

function listedCommands(reply: ToolReply): readonly JsonValue[] {
  return reply.json !== null && isJsonArray(reply.json) ? reply.json : []
}

describe("the HTTP route inventory against the real remote MCP server", () => {
  test("every route that points at an MCP tool names a tool the server registers", async () => {
    const registered = new Set((await client.listTools()).tools.map((tool) => tool.name))
    const missing = listHttpRoutes().flatMap((route) =>
      route.remote.kind === "mcp-tool" && !registered.has(route.remote.tool) ? [`${route.path} -> ${route.remote.tool}`] : [],
    )
    expect(missing).toEqual([])
  })

  test("every route that points at a command names a registry command a remote client may run", () => {
    const unreachable = listHttpRoutes().flatMap((route) => {
      if (route.remote.kind !== "command") return []
      const { type } = route.remote
      return isCommandType(type) && remotePolicyOf(type).kind === "allowed" ? [] : [`${route.path} -> ${type}`]
    })
    expect(unreachable).toEqual([])
  })

  test("an upload the tus route stores is readable by read_project_file and removable by the upload.delete command", async () => {
    const stored = await call("upload_attachment", {
      projectId,
      fileName: "note.txt",
      contentBase64: Buffer.from("kept for a moment").toString("base64"),
      contentType: "text/plain",
    })
    const attachment = field(stored.json, "attachments")
    const first = attachment !== undefined && isJsonArray(attachment) ? attachment[0] : undefined
    const contentUrl = field(first, "contentUrl")
    const relativePath = field(first, "relativePath")
    if (typeof contentUrl !== "string" || typeof relativePath !== "string") throw new Error("upload_attachment returned no attachment")

    const route = matchRoutePath(HTTP_ROUTES.uploadContent.path, contentUrl)
    expect(route).toEqual({ projectId, storedName: "note.txt" })

    const read = await call("read_project_file", { projectId, path: relativePath })
    expect(field(read.json, "text")).toBe("kept for a moment")

    const removed = await call("kanna_command", { type: "upload.delete", params: { projectId, storedName: "note.txt" } })
    expect(removed.json).toEqual({ deleted: true })
    expect((await call("read_project_file", { projectId, path: relativePath })).isError).toBe(true)
  })

  test("project.listPaths and plugins.list answer a remote client the way the web client's autocomplete and plugin loader need", async () => {
    const paths = await call("kanna_command", { type: "project.listPaths", params: { projectId, query: "hello" } })
    const entries = field(paths.json, "paths")
    expect(entries).toEqual([{ path: "hello.txt", kind: "file" }])

    const plugins = await call("kanna_command", { type: "plugins.list" })
    expect(plugins.json).toEqual({ plugins: [] })
  })
})

describe("kanna_commands and kanna_command against the registry", () => {
  test("kanna_commands lists exactly the registry, and an excluded command carries its reason", async () => {
    const rows = listedCommands(await call("kanna_commands"))
    const listed = rows.map((row) => field(row, "type")).sort()
    expect(listed).toEqual(COMMAND_REGISTRY.map((definition) => definition.type).sort())

    for (const definition of COMMAND_REGISTRY) {
      const row = rows.find((candidate) => field(candidate, "type") === definition.type)
      const remote = field(row, "remote")
      expect(remote, definition.type).toEqual(definition.remote)
      if (definition.remote.kind === "excluded") expect(definition.remote.reason.trim().length, definition.type).toBeGreaterThan(0)
    }
  })

  test("kanna_command refuses every excluded command with the reason the registry states", { timeout: 60_000 }, async () => {
    for (const definition of COMMAND_REGISTRY) {
      if (definition.remote.kind !== "excluded") continue
      const reply = await call("kanna_command", { type: definition.type, params: {} })
      expect(reply.isError, definition.type).toBe(true)
      expect(reply.text, definition.type).toContain(definition.remote.reason)
    }
  })

  test("kanna_command accepts every allowed command that has required params and validates them instead of refusing it", { timeout: 60_000 }, async () => {
    const rows = listedCommands(await call("kanna_commands"))
    const probed: string[] = []
    for (const definition of COMMAND_REGISTRY) {
      if (definition.remote.kind !== "allowed") continue
      const row = rows.find((candidate) => field(candidate, "type") === definition.type)
      const required = field(field(row, "paramsSchema"), "required")
      if (required === undefined || !isJsonArray(required) || required.length === 0) continue
      const reply = await call("kanna_command", { type: definition.type, params: {} })
      expect(reply.isError, definition.type).toBe(true)
      expect(reply.text, definition.type).toContain(`Invalid "${definition.type}" command`)
      probed.push(definition.type)
    }
    expect(probed.length).toBeGreaterThan(50)
  })

  test("kanna_command runs an allowed command that needs no params", async () => {
    const reply = await call("kanna_command", { type: "system.ping" })
    expect(reply.isError).toBe(false)
  })
})
