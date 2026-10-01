import { afterEach, expect, test } from "bun:test"
import { act, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { parseIntentMessage, type DatasetQueryOutcome } from "../../../shared/genui"
import type { JsonObject } from "../../../shared/json"
import { renderClientMarkup, type ClientRenderResult } from "../../lib/testing/renderClientMarkup"
import { renderMessageMarkdown } from "../lexical/markdown/renderMessage"
import { renderMarkdownToReact } from "../lexical/markdown/lexicalToReact"
import type { ChartRendererProps } from "./charts/chart-renderer"
import type { FlowRendererProps } from "./flow/flow-renderer"
import { GenUIHostProvider, READONLY_GENUI_HOST, type GenUIHost } from "./host"

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08"]

const SALES_SEMANTICS: JsonObject = {
  metrics: { revenue: { format: "currency", currency: "USD" } },
  dimensions: { month: { kind: "time", grain: "month" }, customer: {} },
  scenario: { column: "scenario", actual: "Actual", budget: "Budget" },
}

const SALES: JsonObject = {
  source: "inline",
  rows: MONTHS.flatMap((month, index) => [
    { month, customer: "Acme", scenario: "Actual", revenue: 100 + index * 10 },
    { month, customer: "Globex", scenario: "Actual", revenue: 50 },
    { month, customer: "Acme", scenario: "Budget", revenue: 120 },
  ]),
  ...SALES_SEMANTICS,
}

function fence(spec: JsonObject): string {
  return `Here is the report.\n\n\`\`\`kanna-ui\n${JSON.stringify(spec)}\n\`\`\`\n`
}

function report(elements: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    version: 1,
    title: "Revenue",
    root: "page",
    datasets: { sales: SALES },
    elements: { page: { type: "Stack", children: Object.keys(elements) }, ...elements },
    ...extra,
  }
}

function FakeChart({ model, onPointClick }: ChartRendererProps) {
  return (
    <ul aria-label="fake chart">
      {model.xOrder.map((x) => (
        <li key={x}>
          <button type="button" onClick={() => onPointClick?.({ x, series: "" })}>{model.xLabels[x] ?? x}</button>
        </li>
      ))}
    </ul>
  )
}

function FakeFlow({ layout, onSelect }: FlowRendererProps) {
  return (
    <ul aria-label="fake diagram">
      {layout.nodes.map((placed) => (
        <li key={placed.node.id}>
          <button type="button" onClick={() => onSelect(placed.node.id)}>{placed.node.label}</button>
        </li>
      ))}
    </ul>
  )
}

const PIPELINE: JsonObject = {
  version: 1,
  title: "Deploy",
  root: "flow",
  elements: {
    flow: {
      type: "FlowDiagram",
      props: {
        title: "Deploy pipeline",
        nodes: [
          { id: "ship", label: "Ship", kind: "end" },
          { id: "build", label: "Build", status: "running", tone: "info" },
          { id: "push", label: "Push", kind: "start" },
        ],
        edges: [
          { from: "push", to: "build", label: "webhook" },
          { from: "build", to: "ship", type: "flow" },
        ],
      },
    },
  },
}

interface HostLog {
  sent: string[]
  approved: string[]
  queries: number
}

function chatHost(overrides: Partial<GenUIHost> = {}): { host: GenUIHost; log: HostLog } {
  const log: HostLog = { sent: [], approved: [], queries: 0 }
  return {
    log,
    host: {
      ...READONLY_GENUI_HOST,
      chatId: "chat-1",
      readonly: false,
      workspaceRoot: "/work",
      sendToAgent: async (message) => {
        log.sent.push(message)
      },
      approveTool: async (server, tool) => {
        log.approved.push(`${server}/${tool}`)
      },
      ChartRenderer: FakeChart,
      FlowRenderer: FakeFlow,
      ...overrides,
    },
  }
}

const mounted: ClientRenderResult[] = []

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.cleanup()
})

async function mount(content: ReactNode, host: GenUIHost): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = await renderClientMarkup(
    <QueryClientProvider client={client}>
      <GenUIHostProvider value={host}>{content}</GenUIHostProvider>
    </QueryClientProvider>,
  )
  mounted.push(rendered)
  return rendered.container
}

async function waitFor<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`timed out waiting for ${what}`)
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement | null {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === name) ?? null
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click()
  })
}

test("renders a finished view with Kanna's components, computing the metric from its dataset", async () => {
  const container = await mount(renderMessageMarkdown(fence(report({
    kpi: { type: "FinancialMetric", props: { dataset: "sales", metric: "revenue", period: "2026-08", compareWith: "budget" } },
  }))), chatHost().host)

  const text = await waitFor(() => (container.textContent?.includes("$180") ? container.textContent : null), "the metric")
  expect(text).toContain("vs budget")
})

test("shows a placeholder while the agent is still writing the view, and runs nothing", async () => {
  const container = await mount(renderMessageMarkdown("Working on it:\n```kanna-ui\n{\"version\":1,\"root\":"), chatHost().host)
  expect(container.textContent).toContain("Building view…")
})

test("refuses an invalid view instead of rendering part of it", async () => {
  const container = await mount(renderMessageMarkdown(fence(report({ x: { type: "Iframe", props: { src: "https://example.com" } } }))), chatHost().host)
  const text = await waitFor(() => (container.textContent?.includes("Unable to show this view") ? container.textContent : null), "the fallback")
  expect(text).toContain("unknown component \"Iframe\"")
})

test("a local action changes the bound period and the metric follows without asking the agent", async () => {
  const { host, log } = chatHost()
  const container = await mount(renderMessageMarkdown(fence(report({
    kpi: { type: "FinancialMetric", props: { dataset: "sales", metric: "revenue", period: { $state: "/period" } } },
    may: { type: "Button", props: { label: "May" }, on: { press: { action: "setState", params: { statePath: "/period", value: "2026-05" } } } },
  }, { state: { period: "2026-08" } }))), host)

  await waitFor(() => (container.textContent?.includes("$180") ? true : null), "August revenue")
  await click(await waitFor(() => buttonNamed(container, "May"), "the May button"))
  await waitFor(() => (container.textContent?.includes("$150") ? true : null), "May revenue")
  expect(log.sent).toEqual([])
})

test("clicking a chart point drills down by the configured dimension, deterministically", async () => {
  const { host, log } = chatHost()
  const container = await mount(renderMessageMarkdown(fence(report({
    trend: { type: "FinancialChart", props: { chart: "line", dataset: "sales", metric: "revenue", dimension: "month", drilldown: { dimension: "customer" } } },
  }))), host)

  await click(await waitFor(() => buttonNamed(container, "Aug 2026"), "the August point"))
  await waitFor(() => buttonNamed(container, "Acme"), "the customer breakdown")
  expect(buttonNamed(container, "Globex")).not.toBeNull()
  expect(container.textContent).toContain("Back")
  expect(log.sent).toEqual([])
})

test("the table view drills down without the canvas, then moves focus to Back so a keyboard user is not stranded", async () => {
  const container = await mount(renderMessageMarkdown(fence(report({
    trend: { type: "FinancialChart", props: { chart: "line", dataset: "sales", metric: "revenue", dimension: "month", drilldown: { dimension: "customer" } } },
  }, { title: "Revenue by month" }))), chatHost().host)

  await click(await waitFor(() => buttonNamed(container, "Table"), "the Table toggle"))
  await click(await waitFor(() => container.querySelector<HTMLButtonElement>('button[aria-label="Break down Aug 2026 by customer"]'), "the August row"))
  const back = await waitFor(() => buttonNamed(container, "Back"), "the Back button")
  await waitFor(() => (document.activeElement === back ? true : null), "focus on Back")
  expect(container.textContent).toContain("Aug 2026 by customer")
})

test("Explain variance asks first, then sends the agent structured values rather than button text", async () => {
  const { host, log } = chatHost()
  const container = await mount(renderMessageMarkdown(fence(report({
    trend: { type: "FinancialChart", props: { chart: "bar", dataset: "sales", metric: "revenue", dimension: "month", period: "2026-08", compareWith: "budget", explain: true } },
  }))), host)

  await click(await waitFor(() => buttonNamed(container, "Explain variance"), "the explain button"))
  await click(await waitFor(() => buttonNamed(container, "Send"), "the confirmation"))
  await waitFor(() => (log.sent.length > 0 ? true : null), "the message")

  const intent = parseIntentMessage(log.sent[0] ?? "")
  expect(intent?.action).toBe("financial.explainVariance")
  expect(intent?.context.values).toMatchObject({ current: 180, baseline: 120, change: 60 })
})

test("a shared read-only view offers no agent actions and does not fetch workspace data", async () => {
  const fileSales: JsonObject = { source: "file", path: "sales.csv", ...SALES_SEMANTICS }
  const container = await mount(renderMarkdownToReact(fence(report({
    trend: { type: "FinancialChart", props: { chart: "line", dataset: "sales", metric: "revenue", dimension: "month", explain: true } },
  }, { datasets: { sales: fileSales } }))), READONLY_GENUI_HOST)

  const text = await waitFor(() => (container.textContent?.includes("shared view") ? container.textContent : null), "the read-only notice")
  expect(text).not.toContain("Explain variance")
})

test("an MCP-backed view asks before calling a tool that is not read-only, then shows the data", async () => {
  let approved = false
  const answer: DatasetQueryOutcome = {
    status: "ok",
    revision: "r1",
    fetchedAt: 1,
    result: {
      rows: [],
      totals: { values: { total: 42 } },
      period: { label: "All time", window: null },
      timeDimension: null,
      grain: null,
      truncated: false,
      sourceRowCount: 1,
    },
  }
  const { host, log } = chatHost({
    queryDataset: async () => (approved ? answer : { status: "needs_approval", server: "books", tool: "report", message: "Allow it?" }),
    approveTool: async (server, tool) => {
      approved = true
      log.approved.push(`${server}/${tool}`)
    },
  })
  const container = await mount(renderMessageMarkdown(fence({
    version: 1,
    root: "kpi",
    datasets: { deals: { source: "mcp", server: "books", tool: "report", metrics: { total: { format: "number" } } } },
    elements: { kpi: { type: "FinancialMetric", props: { dataset: "deals", metric: "total" } } },
  })), host)

  await click(await waitFor(() => buttonNamed(container, "Allow for this chat"), "the approval prompt"))
  await waitFor(() => (container.textContent?.includes("42") ? true : null), "the approved data")
  expect(log.approved).toEqual(["books/report"])
})

test("a user message carrying view context shows a compact chip instead of raw JSON", async () => {
  const container = await mount(renderMarkdownToReact("Fix: login test\n\n```kanna-ui-intent\n{\"action\":\"agent.fix\",\"context\":{\"path\":\"a.ts\"}}\n```"), READONLY_GENUI_HOST)
  expect(container.textContent).toContain("Fix request from a view")
})

test("an income statement lists sections in their declared order, not alphabetically", async () => {
  const container = await mount(renderMessageMarkdown(fence({
    version: 1,
    root: "pl",
    datasets: {
      pnl: {
        source: "inline",
        rows: [
          { section: "Revenue", account: "Sales", amount: 100 },
          { section: "Cost of sales", account: "Hosting", amount: -40 },
        ],
        metrics: { amount: { format: "currency", currency: "USD" } },
        dimensions: { section: { order: ["Revenue", "Cost of sales"] }, account: {} },
      },
    },
    elements: { pl: { type: "IncomeStatement", props: { dataset: "pnl", metric: "amount", rows: "account", groupRows: "section" } } },
  })), chatHost().host)

  const text = await waitFor(() => (container.textContent?.includes("Hosting") ? container.textContent : null), "the statement")
  expect(text.indexOf("Revenue")).toBeLessThan(text.indexOf("Cost of sales"))
})

test("asking the agent about a diagram step sends the step with its neighbours, not just its name", async () => {
  const { host, log } = chatHost()
  const container = await mount(renderMessageMarkdown(fence(PIPELINE)), host)

  await click(await waitFor(() => buttonNamed(container, "Build"), "the laid-out diagram"))
  await click(await waitFor(() => buttonNamed(container, "Ask agent"), "the step details"))
  await click(await waitFor(() => buttonNamed(container, "Send"), "the confirmation"))
  await waitFor(() => (log.sent.length > 0 ? true : null), "the message")

  const intent = parseIntentMessage(log.sent[0] ?? "")
  expect(intent?.action).toBe("agent.investigate")
  expect(intent?.context).toMatchObject({
    diagram: "Deploy pipeline",
    step: "Build",
    status: "running",
    upstream: [{ step: "Push", edge: "static", label: "webhook" }],
    downstream: [{ step: "Ship", edge: "flow" }],
  })
})

test("the outline reads a diagram in flow order, not declaration order, and marks live edges", async () => {
  const container = await mount(renderMessageMarkdown(fence(PIPELINE)), chatHost().host)

  await click(await waitFor(() => buttonNamed(container, "Outline"), "the Outline toggle"))
  const steps = await waitFor(() => {
    const list = container.querySelector("ol")
    return list ? [...list.querySelectorAll("li button")].map((button) => button.textContent) : null
  }, "the outline")
  expect(steps).toEqual(["Push", "Build", "Ship"])
  expect(container.querySelector("ol")?.textContent).toContain("Ship · live")
})
