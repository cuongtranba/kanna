import { expect, test } from "bun:test"
import type { JsonObject } from "../json"
import { parseGenUISpec, type GenUIIssue } from "./index"

const PNL_DATASET: JsonObject = {
  source: "file",
  path: "reports/pnl.csv",
  metrics: { revenue: { format: "currency", currency: "USD" } },
  dimensions: { month: { kind: "time" }, customer: {} },
}

function specWith(elements: JsonObject, extra: JsonObject = {}): JsonObject {
  return { version: 1, root: "page", datasets: { pnl: PNL_DATASET }, elements: { page: { type: "Stack", children: Object.keys(elements) }, ...elements }, ...extra }
}

function issuesOf(input: JsonObject | string): GenUIIssue[] {
  const result = parseGenUISpec(input)
  if (result.ok) throw new Error("expected the spec to be rejected")
  return result.issues
}

test("accepts a dataset-bound report with state bindings and keeps its action bindings", () => {
  const result = parseGenUISpec(JSON.stringify(specWith({
    period: { type: "PeriodSelector", props: { value: { $bindState: "/period" } } },
    chart: { type: "FinancialChart", props: { chart: "line", dataset: "pnl", metric: "revenue", dimension: "month", period: { $state: "/period" } } },
    ask: { type: "Button", props: { label: "Why?" }, on: { press: { action: "financial.explainVariance", params: { dataset: "pnl", metric: "revenue", period: { $state: "/period" } } } } },
  }, { state: { period: "last-12-months" } })))

  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  expect(result.spec.elements.ask?.on?.press).toEqual([
    { action: "financial.explainVariance", params: { dataset: "pnl", metric: "revenue", period: { $state: "/period" } } },
  ])
})

test("fails closed on a protocol version this Kanna does not read", () => {
  expect(issuesOf({ ...specWith({}), version: 2 })).toEqual([
    { path: "version", message: "unsupported protocol version 2; this Kanna reads version 1" },
  ])
})

test("rejects a component outside the catalog", () => {
  const [issue] = issuesOf(specWith({ x: { type: "Iframe", props: { src: "https://example.com" } } }))
  expect(issue?.path).toBe("elements.x.type")
})

test("rejects props json-render alone would let through: a wrong type and an extra handler string", () => {
  const issues = issuesOf(specWith({
    card: { type: "Card", props: { title: 3 } },
    text: { type: "Text", props: { text: "hi", onClick: "alert(1)" } },
  }))
  expect(issues.map((issue) => issue.path)).toEqual(["elements.card.props.title", "elements.text.props"])
})

test("rejects an action outside the catalog and invalid params for a known one", () => {
  const issues = issuesOf(specWith({
    run: { type: "Button", props: { label: "Run" }, on: { press: { action: "shell.run", params: { command: "rm -rf ." } } } },
    link: { type: "Button", props: { label: "Open" }, on: { press: { action: "link.open", params: { url: "javascript:alert(1)" } } } },
  }))
  expect(issues.map((issue) => issue.path)).toEqual(["elements.run.on.press.0.action", "elements.link.on.press.0.params.url"])
})

test("rejects an event the component never emits", () => {
  const [issue] = issuesOf(specWith({ card: { type: "Card", on: { press: { action: "dataset.refresh", params: { dataset: "pnl" } } } } }))
  expect(issue).toEqual({ path: "elements.card.on.press", message: "Card emits no events" })
})

test("rejects expressions that would execute code", () => {
  const [issue] = issuesOf(specWith({ text: { type: "Text", props: { text: { $computed: "anything" } } } }))
  expect(issue?.path).toBe("elements.text.props.text")
})

test("rejects a component that names a metric its dataset does not declare", () => {
  const [issue] = issuesOf(specWith({ kpi: { type: "FinancialMetric", props: { dataset: "pnl", metric: "ebitda" } } }))
  expect(issue).toEqual({ path: "elements.kpi.props", message: "dataset \"pnl\" has no metric \"ebitda\"" })
})

test("rejects a file dataset that escapes the working directory", () => {
  const issues = issuesOf(specWith({}, { datasets: { pnl: { ...PNL_DATASET, path: "../secrets.csv" } } }))
  expect(issues.map((issue) => issue.path)).toContain("datasets.pnl.path")
})

test("reports a child reference to an element that does not exist", () => {
  const issues = issuesOf({ version: 1, root: "page", elements: { page: { type: "Stack", children: ["missing"] } } })
  expect(issues[0]?.path).toBe("elements.page")
})

test("rejects text that is not a JSON object", () => {
  expect(issuesOf("{not json")).toEqual([{ path: "", message: "the spec must be one JSON object" }])
})

test("rejects a FlowDiagram whose edge or group points at a node or group it never declares", () => {
  const issues = issuesOf(specWith({
    flow: {
      type: "FlowDiagram",
      props: {
        nodes: [{ id: "a", label: "A", group: "backend" }, { id: "b", label: "B" }],
        edges: [{ from: "a", to: "b" }, { from: "b", to: "ghost", type: "flow" }],
      },
    },
  }))
  expect(issues.map((issue) => issue.path)).toEqual(["elements.flow.props.nodes.0.group", "elements.flow.props.edges.1.to"])
})
