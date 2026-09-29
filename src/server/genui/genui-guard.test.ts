import { expect, test } from "bun:test"
import { createModelEscalation } from "../model-escalation"
import { createGenUIGuard } from "./genui-guard"
import { runValidateUi } from "./validate-ui-tool"

interface Enqueued {
  chatId: string
  content: string
}

function harness(missingFiles: readonly string[] = []) {
  const enqueued: Enqueued[] = []
  const escalation = createModelEscalation({
    name: "genui",
    enabled: true,
    hasQueuedMessage: () => false,
    enqueueMessage: async (chatId, content) => {
      enqueued.push({ chatId, content })
    },
  })
  const guard = createGenUIGuard(
    escalation,
    async (_chatId, decl) => (decl.source === "file" && missingFiles.includes(decl.path) ? `"${decl.path}" does not exist` : null),
    true,
  )
  return { guard, enqueued }
}

const fence = (spec: string) => `Here you go:\n\`\`\`kanna-ui\n${spec}\n\`\`\`\n`

const VALID = JSON.stringify({ version: 1, root: "t", elements: { t: { type: "Text", props: { text: "hi" } } } })
const UNKNOWN_COMPONENT = JSON.stringify({ version: 1, root: "t", elements: { t: { type: "Iframe", props: {} } } })
const FILE_BACKED = JSON.stringify({
  version: 1,
  root: "k",
  datasets: { pnl: { source: "file", path: "reports/pnl.csv", metrics: { revenue: {} } } },
  elements: { k: { type: "FinancialMetric", props: { dataset: "pnl", metric: "revenue" } } },
})

test("asks the model once to fix a view that cannot render, naming the problem", async () => {
  const { guard, enqueued } = harness()
  await guard.check("chat", [fence(UNKNOWN_COMPONENT)])
  await guard.check("chat", [fence(UNKNOWN_COMPONENT)])
  expect(enqueued).toHaveLength(1)
  expect(enqueued[0]?.content).toContain("elements.t.type: unknown component \"Iframe\"")
})

test("stays quiet for a valid view and for a fence the model is still writing", async () => {
  const { guard, enqueued } = harness()
  await guard.check("chat", [fence(VALID), "```kanna-ui\n{\"version\":1,"])
  expect(enqueued).toEqual([])
})

test("flags a file dataset the view points at but that does not exist", async () => {
  const { guard, enqueued } = harness(["reports/pnl.csv"])
  await guard.check("chat", [fence(FILE_BACKED)])
  expect(enqueued[0]?.content).toContain("datasets.pnl: \"reports/pnl.csv\" does not exist")
})

test("validate_ui answers VALID for a good spec and lists every problem otherwise", async () => {
  expect(await runValidateUi(VALID, async () => null)).toEqual({ content: [{ type: "text", text: "VALID" }] })
  const rejected = await runValidateUi(UNKNOWN_COMPONENT, async () => null)
  expect(rejected.isError).toBe(true)
})
