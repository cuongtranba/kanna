import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const SESSION_ID = "6f1f5b8e-0d4e-4f55-9a55-5c0b7c2f9e11"
const MONTHS = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]
const CUSTOMERS: Record<string, number> = { Acme: 620_000, Globex: 310_000, Initech: 140_000 }

function salesCsv(): string {
  const lines = ["month,customer,scenario,revenue"]
  MONTHS.forEach((month, index) => {
    for (const [customer, base] of Object.entries(CUSTOMERS)) {
      const actual = Math.round(base * (1 + index * 0.03) * (month === "2026-08" && customer === "Acme" ? 0.82 : 1))
      lines.push(`${month},${customer},Actual,${actual}`)
      lines.push(`${month},${customer},Budget,${Math.round(base * (1 + index * 0.035))}`)
    }
  })
  return `${lines.join("\n")}\n`
}

function pnlCsv(): string {
  const lines = [
    ["Revenue", "Product revenue", 11_200_000],
    ["Revenue", "Services revenue", 1_600_000],
    ["Cost of sales", "Hosting", -2_900_000],
    ["Cost of sales", "Support", -1_300_000],
    ["Operating expenses", "Payroll", -4_100_000],
    ["Operating expenses", "Marketing", -1_300_000],
    ["Operating expenses", "Other", -800_000],
  ].flatMap(([section, account, amount]) => [
    `${section},${account},2026,Actual,${amount}`,
    `${section},${account},2025,Actual,${Math.round(Number(amount) * 0.88)}`,
  ])
  return `section,account,year,scenario,amount\n${lines.join("\n")}\n`
}

export const REPORT_SPEC = {
  version: 1,
  title: "FY2026 revenue report",
  root: "page",
  state: { period: "last-12-months", compare: "budget" },
  datasets: {
    sales: {
      source: "file",
      path: "reports/sales.csv",
      metrics: { revenue: { format: "currency", currency: "USD" } },
      dimensions: { month: { kind: "time", grain: "month" }, customer: {} },
      scenario: { column: "scenario", actual: "Actual", budget: "Budget" },
    },
    pnl: {
      source: "file",
      path: "reports/pnl.csv",
      metrics: { amount: { format: "currency", currency: "USD" } },
      dimensions: { year: { kind: "time", grain: "year" }, section: { order: ["Revenue", "Cost of sales", "Operating expenses"] }, account: { parent: "section" } },
      scenario: { column: "scenario", actual: "Actual" },
    },
    bridge: {
      source: "inline",
      rows: [
        { step: "Revenue", amount: 12_800_000 },
        { step: "Cost of sales", amount: -4_200_000 },
        { step: "Payroll", amount: -4_100_000 },
        { step: "Other opex", amount: -2_100_000 },
      ],
      metrics: { amount: { format: "currency", currency: "USD" } },
      dimensions: { step: { order: ["Revenue", "Cost of sales", "Payroll", "Other opex"] } },
    },
  },
  elements: {
    page: { type: "Stack", children: ["controls", "tiles", "trend", "drill", "grid", "statement"] },
    controls: { type: "Grid", props: { columns: 2 }, children: ["period", "compare"] },
    period: { type: "PeriodSelector", props: { value: { $bindState: "/period" } } },
    compare: { type: "CompareSelector", props: { value: { $bindState: "/compare" } } },
    tiles: { type: "Grid", props: { columns: 3 }, children: ["revenueTile", "augTile", "acmeTile"] },
    revenueTile: { type: "FinancialMetric", props: { dataset: "sales", metric: "revenue", period: { $state: "/period" }, compareWith: { $state: "/compare" } } },
    augTile: { type: "FinancialMetric", props: { dataset: "sales", metric: "revenue", label: "August revenue", period: "2026-08", compareWith: "budget" } },
    acmeTile: { type: "FinancialMetric", props: { dataset: "sales", metric: "revenue", label: "Acme revenue", period: { $state: "/period" }, compareWith: "previous-period", filters: [{ dimension: "customer", value: "Acme" }] } },
    trend: {
      type: "FinancialChart",
      props: { chart: "line", dataset: "sales", metric: "revenue", dimension: "month", period: { $state: "/period" }, compareWith: { $state: "/compare" }, drilldown: { dimension: "customer" }, explain: true },
    },
    drill: {
      type: "Button",
      props: { label: "Break down August by customer" },
      on: { press: { action: "financial.drilldown", params: { dataset: "sales", metric: "revenue", dimension: "month", value: "2026-08", into: "customer" } } },
    },
    grid: { type: "Grid", props: { columns: 2 }, children: ["bridgeChart", "mix"] },
    bridgeChart: { type: "FinancialChart", props: { chart: "waterfall", dataset: "bridge", metric: "amount", dimension: "step", title: "EBITDA bridge", totalLabel: "EBITDA" } },
    mix: { type: "FinancialChart", props: { chart: "stacked-bar", dataset: "sales", metric: "revenue", dimension: "month", series: "customer", period: "last-4-months", title: "Revenue by customer" } },
    statement: { type: "IncomeStatement", props: { dataset: "pnl", metric: "amount", rows: "account", groupRows: "section", period: "2026", compareWith: "previous-period", totals: [{ label: "Gross profit", groups: ["Revenue", "Cost of sales"] }, { label: "EBITDA", groups: ["Revenue", "Cost of sales", "Operating expenses"] }] } },
  },
}

function sessionJsonl(cwd: string): string {
  const base = { sessionId: SESSION_ID, cwd, version: "2.1.0" }
  const records = [
    { ...base, type: "user", uuid: "u-1", timestamp: "2026-09-01T10:00:00.000Z", message: { role: "user", content: "Show revenue for the last 12 months against budget" } },
    {
      ...base,
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-09-01T10:00:05.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: `Here is the revenue report.\n\n\`\`\`kanna-ui\n${JSON.stringify(REPORT_SPEC, null, 2)}\n\`\`\`` }],
      },
    },
  ]
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

export async function seedGenUIReport(kannaHome: string): Promise<void> {
  const project = join(kannaHome, "genui-demo")
  await mkdir(join(project, "reports"), { recursive: true })
  await writeFile(join(project, "reports", "sales.csv"), salesCsv())
  await writeFile(join(project, "reports", "pnl.csv"), pnlCsv())
  const sessions = join(kannaHome, ".claude", "projects", "genui-demo")
  await mkdir(sessions, { recursive: true })
  await writeFile(join(sessions, `${SESSION_ID}.jsonl`), sessionJsonl(project))
}
