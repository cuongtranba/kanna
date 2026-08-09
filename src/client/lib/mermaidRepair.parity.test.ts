import { beforeAll, expect, test } from "bun:test"
import { LINK_RULES_FOR_PARITY, repairMermaidSource } from "./mermaidRepair"

/**
 * Pins every repair rule against mermaid's own grammar.
 *
 * A rule is only honest if BOTH halves hold: the `from` spelling must be one
 * mermaid rejects (otherwise the repair rewrites working diagrams) and the `to`
 * spelling must be one it accepts (otherwise the repair fixes nothing). Neither
 * can be settled by reading the docs — mermaid's grammar is the authority, so
 * this test asks it directly. A mermaid upgrade that starts accepting `-.x`
 * fails here, which is exactly when the rule should be retired.
 */

interface MermaidParser {
  initialize: (config: { startOnLoad: boolean; securityLevel: "strict" }) => void
  parse: (text: string) => Promise<unknown>
}

let mermaid: MermaidParser

beforeAll(async () => {
  mermaid = (await import("mermaid")).default as unknown as MermaidParser
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" })
})

async function parses(source: string): Promise<boolean> {
  try {
    await mermaid.parse(source)
    return true
  } catch {
    return false
  }
}

const diagram = (link: string) => `flowchart LR\n  A[a] ${link} B[b]`

test("every rule rewrites a spelling mermaid rejects into one it accepts", async () => {
  expect(LINK_RULES_FOR_PARITY.length).toBeGreaterThan(0)
  for (const rule of LINK_RULES_FOR_PARITY) {
    expect(await parses(diagram(rule.from))).toBe(false)
    expect(await parses(diagram(rule.to))).toBe(true)
  }
}, 30_000)

test("the diagram from the audit that motivated this renders after repair", async () => {
  // Verbatim from chat 02b439e1 ("Observable Tracing Audit"). Two `-.x` links;
  // mermaid blamed line 4 while the first defect is on line 3.
  const original = [
    "flowchart LR",
    "  U[User sees<br/>WORK-ITEM_TECHNICAL_UNEXPECTED] -.->|no id| B[ErrorBoundary<br/>void error]",
    "  B -.x|discarded| N[nothing]",
    "  U -.->|no id| API[api.ts fetch<br/>no header sent]",
    "  API -->|HTTP| H[Hono routes<br/>no request middleware]",
    "  H --> F[flow catch<br/>cause destroyed]",
    "  F -.x|no log emitted| N2[nothing]",
    "  H --> P[pino<br/>startup + shutdown only]",
    "  style N fill:#fee,stroke:#c00",
    "  style N2 fill:#fee,stroke:#c00",
  ].join("\n")

  expect(await parses(original)).toBe(false)

  const repaired = repairMermaidSource(original)
  expect(repaired.repairs).toEqual([
    { line: 3, from: "-.x", to: "-.-x" },
    { line: 7, from: "-.x", to: "-.-x" },
  ])
  expect(await parses(repaired.source)).toBe(true)
}, 30_000)

test("a diagram whose label contains the defect survives repair unparsed", async () => {
  // Valid today, so the renderer never calls the repair on it — but if some
  // other line broke, the repair must not rewrite the label.
  const source = 'flowchart LR\n  A["uses -.x here"] --> B[b]'
  expect(await parses(source)).toBe(true)
  expect(repairMermaidSource(source).repairs).toEqual([])
}, 30_000)
