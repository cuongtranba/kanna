import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, symlink, utimes, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { datasetDeclSchema, type DatasetDecl } from "../../shared/genui"
import type { DatasetQueryOutcome } from "../../shared/genui/protocol"
import type { JsonObject, JsonValue } from "../../shared/json"
import type { McpServerConfig } from "../../shared/mcp-types"
import { POLICY_DEFAULT, type ChatPermissionPolicy } from "../../shared/permission-policy"
import { datasetFileReader } from "./dataset-file.adapter"
import type { McpDataClient } from "./dataset-ports"
import { GenUIDatasetService } from "./dataset-service"

let root: string
let outside: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kanna-genui-root-"))
  outside = await mkdtemp(path.join(tmpdir(), "kanna-genui-outside-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

const SERVER: McpServerConfig = {
  id: "srv-1",
  name: "books",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastTest: { status: "untested" },
  transport: "http",
  url: "https://books.example.com/mcp",
  headers: {},
}

function fakeMcp(tools: Record<string, { readOnly: boolean; value: JsonValue }>): McpDataClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    listTools: async () => Object.entries(tools).map(([name, tool]) => ({ name, readOnly: tool.readOnly })),
    callTool: async (_server, tool, args: JsonObject) => {
      calls.push(`${tool}:${JSON.stringify(args)}`)
      const entry = tools[tool]
      return entry ? { ok: true, value: entry.value } : { ok: false, message: "no such tool" }
    },
  }
}

function service(mcp: McpDataClient = fakeMcp({}), policy: ChatPermissionPolicy = POLICY_DEFAULT): GenUIDatasetService {
  return new GenUIDatasetService({
    files: datasetFileReader,
    mcp,
    scopeOf: (chatId) => (chatId === "gone" ? null : { cwd: root, policy }),
    mcpServers: () => [SERVER],
  })
}

function fileDataset(filePath: string): DatasetDecl {
  return datasetDeclSchema.parse({ source: "file", path: filePath, metrics: { revenue: {} }, dimensions: { region: {} } })
}

function mcpDataset(tool: string): DatasetDecl {
  return datasetDeclSchema.parse({ source: "mcp", server: "books", tool, arguments: { tenantId: "t-1" }, metrics: { total: {} }, dimensions: { stage: {} } })
}

function totalOf(outcome: DatasetQueryOutcome, metric: string): number | null | undefined {
  if (outcome.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(outcome)}`)
  return outcome.result.totals.values[metric]
}

test("answers a query from a CSV in the chat's working directory and sees the file change without a new spec", async () => {
  const file = path.join(root, "sales.csv")
  await writeFile(file, "region,revenue\nnorth,10\nsouth,5\n")
  const datasets = service()
  expect(totalOf(await datasets.query("chat", fileDataset("sales.csv"), { metrics: ["revenue"] }), "revenue")).toBe(15)

  await writeFile(file, "region,revenue\nnorth,10\nsouth,5\neast,20\n")
  await utimes(file, new Date(), new Date(Date.now() + 5_000))
  expect(totalOf(await datasets.query("chat", fileDataset("sales.csv"), { metrics: ["revenue"] }), "revenue")).toBe(35)
})

test("refuses a file that a symlink carries outside the working directory", async () => {
  await writeFile(path.join(outside, "secrets.csv"), "region,revenue\nnorth,1\n")
  await symlink(path.join(outside, "secrets.csv"), path.join(root, "innocent.csv"))
  const outcome = await service().query("chat", fileDataset("innocent.csv"), { metrics: ["revenue"] })
  expect(outcome.status === "error" ? outcome.code : outcome.status).toBe("unauthorized")
})

test("honours the chat policy's readPathDeny for dataset files", async () => {
  await mkdir(path.join(root, "private"))
  await writeFile(path.join(root, "private", "payroll.csv"), "region,revenue\nnorth,1\n")
  const policy = { ...POLICY_DEFAULT, readPathDeny: [path.join(root, "private")] }
  const outcome = await service(fakeMcp({}), policy).query("chat", fileDataset("private/payroll.csv"), { metrics: ["revenue"] })
  expect(outcome.status === "error" ? outcome.code : outcome.status).toBe("unauthorized")
})

test("asks before calling an MCP tool that does not declare itself read-only, and remembers the approval per chat", async () => {
  const mcp = fakeMcp({ answer: { readOnly: false, value: { columns: [{ name: "stage" }, { name: "total" }], rows: [["won", 7], ["lost", 3]] } } })
  const datasets = service(mcp)

  const first = await datasets.query("chat-a", mcpDataset("answer"), { metrics: ["total"] })
  expect(first).toEqual({ status: "needs_approval", server: "books", tool: "answer", message: expect.any(String) })
  expect(mcp.calls).toEqual([])

  datasets.approveTool("chat-a", "books", "answer")
  expect(totalOf(await datasets.query("chat-a", mcpDataset("answer"), { metrics: ["total"] }), "total")).toBe(10)
  expect((await datasets.query("chat-b", mcpDataset("answer"), { metrics: ["total"] })).status).toBe("needs_approval")
})

test("calls a read-only MCP tool without asking and reads rows from its result", async () => {
  const mcp = fakeMcp({ report: { readOnly: true, value: { rows: [{ stage: "won", total: 4 }] } } })
  expect(totalOf(await service(mcp).query("chat", mcpDataset("report"), { metrics: ["total"] }), "total")).toBe(4)
  expect(mcp.calls).toEqual(["report:{\"tenantId\":\"t-1\"}"])
})

test("reports an MCP server that is not configured as missing, before calling anything", async () => {
  const decl = datasetDeclSchema.parse({ source: "mcp", server: "ledger", tool: "rows", metrics: { total: {} } })
  const outcome = await service().query("chat", decl, { metrics: ["total"] })
  expect(outcome.status === "error" ? outcome.code : outcome.status).toBe("not_found")
})
