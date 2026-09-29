import { describe, expect, test } from "bun:test"
import type { DatasetDecl } from "../../shared/genui"
import { datasetFreezeKey, datasetDeclSchema } from "../../shared/genui"
import { CHAT_SNAPSHOT_VERSION, type FrozenDataset } from "../../shared/session-share/types"
import type { TranscriptEntry } from "../../shared/transcript-types"
import { buildChatSnapshot, type SnapshotSources } from "./snapshot-builder"

const SALES_DATASET = { source: "file", path: "reports/sales.csv", metrics: { revenue: { format: "number" } }, dimensions: { region: {} } }

const REPORT_VIEW = [
  "Here is the report:",
  "```kanna-ui",
  JSON.stringify({
    version: 1,
    root: "total",
    datasets: {
      sales: SALES_DATASET,
      notes: { source: "inline", rows: [{ region: "north", revenue: 1 }], metrics: { revenue: {} } },
    },
    elements: {
      total: { type: "FinancialMetric", props: { dataset: "sales", metric: "revenue" } },
    },
  }),
  "```",
].join("\n")

const TRANSCRIPT: TranscriptEntry[] = [
  { kind: "system_init", _id: "e0", createdAt: 0, provider: "claude", model: "claude-opus", tools: [], agents: [], slashCommands: [], mcpServers: [] },
  { kind: "account_info", _id: "e1", createdAt: 1, accountInfo: { email: "owner@example.com" } },
  {
    kind: "user_prompt",
    _id: "e2",
    createdAt: 2,
    content: "show the report",
    attachments: [{ id: "a1", kind: "file", displayName: "secret.pdf", absolutePath: "/Users/owner/secret.pdf", relativePath: "./secret.pdf", contentUrl: "/api/x", mimeType: "application/pdf", size: 1 }],
  },
  { kind: "tool_call", _id: "e3", createdAt: 3, tool: { kind: "tool", toolKind: "read_file", toolName: "Read", toolId: "toolu_1", input: { filePath: "/repo/a.ts" } } },
  { kind: "tool_result", _id: "e4", createdAt: 4, toolId: "toolu_1", content: "file body", debugRaw: JSON.stringify({ tool_use_result: { file: "copy of file body" } }) },
  { kind: "tool_call", _id: "q1", createdAt: 4, tool: { kind: "tool", toolKind: "ask_user_question", toolName: "AskUserQuestion", toolId: "toolu_q", input: { questions: [] } } },
  { kind: "tool_result", _id: "q2", createdAt: 4, toolId: "toolu_q", content: "answered", debugRaw: JSON.stringify({ tool_use_result: { answers: { pick: "a" } }, requestHeaders: { authorization: "Bearer secret" } }) },
  { kind: "assistant_text", _id: "e5", createdAt: 5, text: REPORT_VIEW, debugRaw: "{\"raw\":\"provider payload\"}" },
  { kind: "assistant_text", _id: "e6", createdAt: 6, text: "hidden", hidden: true },
]

function sources(frozen: FrozenDataset = { status: "ok", rows: [{ region: "north", revenue: 10 }] }): SnapshotSources & { frozenDecls: DatasetDecl[] } {
  const frozenDecls: DatasetDecl[] = []
  return {
    frozenDecls,
    getChatMeta: () => ({ id: "c1", title: "t", model: "claude-opus", createdAt: 1 }),
    getTranscript: () => TRANSCRIPT,
    freezeDataset: (_chatId, decl) => {
      frozenDecls.push(decl)
      return Promise.resolve(frozen)
    },
    getAttachments: () => [],
  }
}

describe("buildChatSnapshot", () => {
  test("publishes the conversation the chat renders and withholds account details, attachments and raw provider payloads beyond what a tool card reads", async () => {
    const snap = await buildChatSnapshot(sources(), "c1")
    expect(snap.version).toBe(CHAT_SNAPSHOT_VERSION)
    expect(snap.entries.map((entry) => entry._id)).toEqual(["e2", "e3", "e4", "q1", "q2", "e5"])
    const published = JSON.stringify(snap)
    expect(published).not.toContain("owner@example.com")
    expect(published).not.toContain("/Users/owner/secret.pdf")
    expect(published).not.toContain("Bearer secret")
    expect(published).not.toContain("provider payload")
    expect(published).not.toContain("copy of file body")
    const answer = snap.entries.find((entry) => entry._id === "q2")
    expect(answer?.debugRaw).toBe(JSON.stringify({ tool_use_result: { answers: { pick: "a" } } }))
  })

  test("freezes the rows of every non-inline dataset a view declares, keyed so the viewer can find them", async () => {
    const src = sources()
    const snap = await buildChatSnapshot(src, "c1")
    expect(src.frozenDecls.map((decl) => decl.source)).toEqual(["file"])
    const key = datasetFreezeKey(datasetDeclSchema.parse(SALES_DATASET))
    expect(snap.datasets[key]).toEqual({ status: "ok", rows: [{ region: "north", revenue: 10 }] })
  })

  test("rejects when the chat is unknown", async () => {
    const src: SnapshotSources = { ...sources(), getChatMeta: () => null }
    let failure: Error | null = null
    try {
      await buildChatSnapshot(src, "missing")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      failure = error
    }
    expect(failure?.message).toMatch(/chat_not_found/)
  })
})
