import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderClientMarkup, type ClientRenderResult } from "../../lib/testing/renderClientMarkup"
import { ShareViewPage } from "./ShareViewPage"
import { datasetDeclSchema, datasetFreezeKey } from "../../../shared/genui"
import type { JsonObject } from "../../../shared/json"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshot, type ChatSnapshotV2 } from "../../../shared/session-share/types"
import type { TranscriptEntry } from "../../../shared/transcript-types"

const READS: TranscriptEntry[] = ["a.ts", "b.ts", "c.ts"].flatMap((file, index): TranscriptEntry[] => [
  { kind: "tool_call", _id: `call-${index}`, createdAt: 10 + index, tool: { kind: "tool", toolKind: "read_file", toolName: "Read", toolId: `toolu_${index}`, input: { filePath: `/repo/${file}` } } },
  { kind: "tool_result", _id: `result-${index}`, createdAt: 20 + index, toolId: `toolu_${index}`, content: `body of ${file}` },
])

const snap: ChatSnapshotV2 = {
  version: CHAT_SNAPSHOT_VERSION,
  chatMeta: { id: "c1", title: "Public chat", model: "claude", createdAt: 0 },
  entries: [
    { kind: "user_prompt", _id: "m1", createdAt: 0, content: "hi" },
    ...READS,
    { kind: "assistant_text", _id: "m2", createdAt: 30, text: "hello" },
  ],
  datasets: {},
  attachmentsManifest: [],
}

const SALES_DATASET: JsonObject = { source: "file", path: "reports/sales.csv", metrics: { revenue: { format: "number" } }, dimensions: { region: {} } }

function reportText(datasetId: string): string {
  const spec = {
    version: 1,
    root: "total",
    datasets: { [datasetId]: SALES_DATASET },
    elements: { total: { type: "FinancialMetric", props: { dataset: datasetId, metric: "revenue", label: "Total revenue" } } },
  }
  return `Report:\n\n\`\`\`kanna-ui\n${JSON.stringify(spec)}\n\`\`\`\n`
}

const mounted: ClientRenderResult[] = []

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.cleanup()
})

async function mount(snapshot: ChatSnapshot): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = await renderClientMarkup(
    <QueryClientProvider client={client}>
      <ShareViewPage snapshot={snapshot} />
    </QueryClientProvider>,
  )
  mounted.push(rendered)
  return rendered.container
}

async function waitForText(container: HTMLElement, text: string): Promise<string> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const current = container.textContent ?? ""
    if (current.includes(text)) return current
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`timed out waiting for "${text}" in: ${container.textContent ?? ""}`)
}

describe("ShareViewPage", () => {
  test("renders chat title and messages from snapshot", async () => {
    const container = await mount(snap)
    const text = container.textContent ?? ""
    expect(text).toContain("Public chat")
    expect(text).toContain("hi")
    expect(text).toContain("hello")
  })

  test("renders tool calls as the chat's collapsed tool rows, not raw JSON", async () => {
    const container = await mount(snap)
    const text = container.textContent ?? ""
    expect(text).toContain("3 reads")
    expect(text).not.toContain("filePath")
    expect(text).not.toContain("tool result")
  })

  test("a link shared before this change renders its tool calls the same way", async () => {
    const legacy: ChatSnapshot = {
      version: 1,
      chatMeta: snap.chatMeta,
      messages: [
        { kind: "user_prompt", id: "m1", createdAt: 0, text: "hi" },
        ...["a.ts", "b.ts"].flatMap((file, index) => [
          { kind: "tool_call" as const, id: `call-${index}`, createdAt: 1, name: "Read", input: { file_path: `/repo/${file}` } },
          { kind: "tool_result" as const, id: `result-${index}`, createdAt: 2, toolCallId: `toolu_${index}`, output: `body of ${file}`, isError: false },
        ]),
      ],
      attachmentsManifest: [],
    }
    const text = (await mount(legacy)).textContent ?? ""
    expect(text).toContain("2 reads")
    expect(text).not.toContain("file_path")
  })

  test("a generative view shows the data captured when the chat was shared", async () => {
    const key = datasetFreezeKey(datasetDeclSchema.parse(SALES_DATASET))
    const container = await mount({
      ...snap,
      entries: [{ kind: "assistant_text", _id: "v1", createdAt: 1, text: reportText("sales") }],
      datasets: { [key]: { status: "ok", rows: [{ region: "north", revenue: 1200 }, { region: "south", revenue: 34 }] } },
    })
    const text = await waitForText(container, "1.23K")
    expect(text).not.toContain("not included in a shared view")
  })

  test("a generative view whose data was not captured says so instead of showing an empty chart", async () => {
    const container = await mount({
      ...snap,
      entries: [{ kind: "assistant_text", _id: "v1", createdAt: 1, text: reportText("sales") }],
      datasets: {},
    })
    await waitForText(container, "not captured when the chat was shared")
  })

  test("composer is absent (no textarea, no input)", async () => {
    const container = await mount(snap)
    expect(container.querySelector("textarea")).toBeNull()
    expect(container.querySelector("input")).toBeNull()
  })

  test("root main is its own scroll container (global body overflow is hidden)", async () => {
    const container = await mount(snap)
    const cls = container.querySelector("main")?.className ?? ""
    expect(cls).toContain("h-[100dvh]")
    expect(cls).toContain("overflow-y-auto")
  })
})
