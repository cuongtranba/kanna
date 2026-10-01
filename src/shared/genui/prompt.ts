import { VALIDATE_UI_TOOL_NAME } from "../tools"
import { GENUI_ACTIONS, GENUI_COMPONENTS } from "./catalog"
import { KANNA_UI_FENCE_LANGUAGE } from "./fences"

const EXAMPLE = JSON.stringify({
  version: 1,
  title: "Revenue",
  root: "page",
  state: { period: "last-12-months", compare: "budget" },
  datasets: {
    pnl: {
      source: "inline",
      columns: ["month", "customer", "scenario", "revenue"],
      rows: [
        ["2026-07", "Acme", "Actual", 42000],
        ["2026-07", "Acme", "Budget", 40000],
        ["2026-08", "Acme", "Actual", 47500],
        ["2026-08", "Acme", "Budget", 41000],
      ],
      metrics: { revenue: { format: "currency", currency: "USD" } },
      dimensions: { month: { kind: "time", grain: "month" }, customer: {} },
      scenario: { column: "scenario", actual: "Actual", budget: "Budget" },
    },
  },
  elements: {
    page: { type: "Stack", children: ["controls", "headline", "trend"] },
    controls: { type: "Grid", props: { columns: 2 }, children: ["period", "compare"] },
    period: { type: "PeriodSelector", props: { value: { $bindState: "/period" } } },
    compare: { type: "CompareSelector", props: { value: { $bindState: "/compare" } } },
    headline: { type: "FinancialMetric", props: { dataset: "pnl", metric: "revenue", period: { $state: "/period" }, compareWith: { $state: "/compare" } } },
    trend: {
      type: "FinancialChart",
      props: { chart: "line", dataset: "pnl", metric: "revenue", dimension: "month", period: { $state: "/period" }, compareWith: { $state: "/compare" }, drilldown: { dimension: "customer" }, explain: true },
    },
  },
})

export interface GenUIPromptOptions {
  canValidate: boolean
}

export function renderGenUIPromptSection(options: GenUIPromptOptions): string {
  const components = Object.entries(GENUI_COMPONENTS).map(([name, def]) => `- ${name}(${def.signature})${def.children ? " [children]" : ""} — ${def.description}`)
  const actions = Object.entries(GENUI_ACTIONS).map(([name, def]) => `- ${name} ${def.signature} [${def.class}] — ${def.description}`)
  const validation = options.canValidate
    ? `Before you send a view, call \`${VALIDATE_UI_TOOL_NAME}\` with the JSON and fix whatever it rejects; it also checks that file and MCP datasets resolve.`
    : "Kanna validates the view when your turn ends and asks you once to fix it if it is invalid, so check it against the rules below."
  return [
    "## Generative UI",
    "",
    `Kanna renders a \`\`\`${KANNA_UI_FENCE_LANGUAGE} fence in your reply as an interactive view built from Kanna's own components. Use it for reports, dashboards, charts, and interactive summaries of structured results (test runs, diagnostics, changed files). Do not use it for prose, a small static table (write a markdown table), or a static diagram (write mermaid). You decide WHAT to show; Kanna renders it, fetches the data, and runs the actions.`,
    "",
    validation,
    "",
    "The fence holds ONE JSON object: {\"version\":1, \"title\"?, \"root\": key, \"elements\": {key: {\"type\", \"props\", \"children\"?: [keys], \"on\"?: {event: {\"action\", \"params\"}}, \"visible\"?}}, \"state\"?, \"datasets\"?}.",
    "",
    "Rules:",
    "- Only the components and actions listed here. Never JavaScript, JSX, HTML, colours, pixel sizes, or chart-library options.",
    "- Data lives in datasets and is referenced by id; never put rows into component props. Sources:",
    "  - inline — the default for any data you already hold: a tool or query result, numbers you computed, rows the user gave you. Write it as a table, {\"source\":\"inline\",\"columns\":[\"month\",\"revenue\"],\"rows\":[[\"2026-07\",42000],…]} (rows as objects also work). A tool result already shaped {columns, rows} can be pasted as is. At most 500 rows and 64 KB, so aggregate before you embed.",
    "  - file — {\"source\":\"file\",\"path\":\"relative/to/cwd.csv\",\"format\"?:\"csv\"|\"json\",\"rowsPath\"?} — only for a data file that already exists in the workspace. Never write a file just to feed a view.",
    "  - mcp — {\"source\":\"mcp\",\"server\":\"<configured MCP server>\",\"tool\":\"<read-only tool>\",\"arguments\"?:{…},\"rowsPath\"?} — when the view should re-query the tool live instead of showing a snapshot.",
    "- Every dataset declares its semantics: \"metrics\": {id: {\"column\"?, \"label\"?, \"format\": currency|percent|number, \"currency\"?, \"aggregate\"?: sum|avg|min|max|last|count, \"derived\"?: {\"op\": ratio|sum|difference, \"of\": [metric ids]}, \"direction\"?: higher-is-better|lower-is-better}} and \"dimensions\": {id: {\"column\"?, \"label\"?, \"kind\"?: time|category, \"grain\"?: day|month|quarter|year, \"order\"?, \"parent\"?}}; optionally \"scenario\": {\"column\", \"actual\", \"budget\"?, \"forecast\"?}, \"fiscalYearStartMonth\", \"refreshSeconds\". Percent values are ratios (0.142 means 14.2%). Balances (cash, receivables) aggregate with \"last\".",
    "- Periods: all, last-N-days|months|quarters|years, ytd, qtd, mtd, fy2026, 2026, 2026-Q3, 2026-08, 2026-08-15, or {\"from\",\"to\"}. Relative periods count back from the latest date in the data.",
    "- compareWith: previous-period, previous-year, budget, forecast (the last two need the scenario column), or none.",
    "- Selectors bind with {\"$bindState\":\"/path\"}; other props read the value with {\"$state\":\"/path\"}. Seed defaults in \"state\". {\"$template\":\"text ${/path}\"} and {\"$cond\":…,\"$then\":…,\"$else\":…} are also allowed.",
    "- \"filters\" is always an array, [{\"dimension\", \"op\"?: eq|neq|in|not-in, \"value\"}], never an object. To filter by a selector's choice, write [{\"dimension\":\"currency\",\"value\":{\"$state\":\"/currency\"}}]. \"totals\" on a table or statement is an array, [{\"label\",\"groups\":[…]}], never true.",
    "- Exploration — changing the period or comparison, drilling into a chart, sorting — runs inside Kanna without you. Only [agent] actions come back to you, as a message carrying a ```kanna-ui-intent block of structured context.",
    "",
    "Components:",
    ...components,
    "",
    "Actions (class in brackets; agent actions reach you only when the user clicks):",
    ...actions,
    "",
    "Example:",
    `\`\`\`${KANNA_UI_FENCE_LANGUAGE}`,
    EXAMPLE,
    "```",
  ].join("\n")
}
