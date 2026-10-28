import { expect, test } from "vite-plus/test"
import { z } from "zod"
import {
  AGENT_INTENT_ACTIONS,
  GENUI_ACTIONS,
  GENUI_COMPONENTS,
  extractKannaUiFences,
  formatIntentMessage,
  parseGenUISpec,
  parseIntentMessage,
  renderGenUIPromptSection,
} from "./index"
import {
  DERIVED_OPS,
  INLINE_DATASET_MAX_BYTES,
  INLINE_DATASET_MAX_ROWS,
  METRIC_AGGREGATES,
  METRIC_FORMATS,
  TIME_GRAINS,
} from "./datasets"
import { COMPARE_MODES } from "./period"
import { DATASET_FILTER_OPS } from "./query"

test("a fence still being streamed is reported open, a finished one closed", () => {
  const streaming = "Here is the report:\n```kanna-ui\n{\"version\":1,"
  const finished = `${streaming}\n"root":"a"}\n\`\`\`\nDone.`
  expect(extractKannaUiFences(streaming).map((fence) => fence.closed)).toEqual([false])
  expect(extractKannaUiFences(finished).map((fence) => fence.closed)).toEqual([true])
})

test("an agent intent survives the round trip through a chat message", () => {
  const message = formatIntentMessage({ action: "agent.fix", headline: "Fix: auth.test.ts > rejects expired tokens", context: { path: "src/auth.test.ts", line: 42 } })
  expect(parseIntentMessage(message)).toEqual({
    headline: "Fix: auth.test.ts > rejects expired tokens",
    action: "agent.fix",
    context: { path: "src/auth.test.ts", line: 42 },
  })
})

test("a context containing backticks cannot close the intent fence early", () => {
  const message = formatIntentMessage({ action: "agent.ask", headline: "Why?", context: { snippet: "```js\nx\n```" } })
  expect(parseIntentMessage(message)?.context).toEqual({ snippet: "```js\nx\n```" })
})

test("both prompt variants name every component and action the validator accepts", () => {
  for (const canValidate of [true, false]) {
    const prompt = renderGenUIPromptSection({ canValidate })
    const missing = [...Object.keys(GENUI_COMPONENTS), ...Object.keys(GENUI_ACTIONS)].filter((name) => !prompt.includes(`- ${name}`))
    expect(missing).toEqual([])
  }
})

test("the prompt's worked example is a view the validator accepts", () => {
  const [example] = extractKannaUiFences(renderGenUIPromptSection({ canValidate: true }))
  const result = parseGenUISpec(example?.source ?? "")
  expect(result.ok ? [] : result.issues).toEqual([])
})

test("every component's prompt signature names each prop its schema accepts", () => {
  const drift = Object.entries(GENUI_COMPONENTS).flatMap(([name, def]) => {
    const shape = def.props instanceof z.ZodObject ? Object.keys(def.props.shape) : []
    return shape.filter((prop) => !def.signature.includes(prop)).map((prop) => `${name}.${prop}`)
  })
  expect(drift).toEqual([])
})

function enumOptionSets(schema: z.core.$ZodType): string[][] {
  if (schema instanceof z.ZodEnum) return [schema.options.map(String)]
  if (schema instanceof z.ZodOptional) return enumOptionSets(schema.unwrap())
  if (schema instanceof z.ZodArray) return enumOptionSets(schema.element)
  if (schema instanceof z.ZodUnion) return schema.options.flatMap(enumOptionSets)
  if (schema instanceof z.ZodObject) return Object.values(schema.shape).flatMap(enumOptionSets)
  if (schema instanceof z.ZodPipe) return enumOptionSets(schema.in)
  return []
}

test("a component signature that spells out an enum spells out every member of it", () => {
  const drift = Object.entries(GENUI_COMPONENTS).flatMap(([name, def]) =>
    enumOptionSets(def.props).flatMap((options) => {
      const tokens = new Set(def.signature.split(/[^\w-]+/))
      const spelled = options.filter((option) => tokens.has(option))
      if (spelled.length === 0 || spelled.length === options.length) return []
      return options.filter((option) => !spelled.includes(option)).map((option) => `${name}: ${option}`)
    }))
  expect(drift).toEqual([])
})

test("the prompt states every enum member and limit the validator enforces", () => {
  const prompt = renderGenUIPromptSection({ canValidate: true })
  const expected = [
    ...METRIC_FORMATS,
    ...METRIC_AGGREGATES,
    ...DERIVED_OPS,
    ...TIME_GRAINS,
    ...DATASET_FILTER_OPS,
    ...COMPARE_MODES,
    `${INLINE_DATASET_MAX_ROWS} rows and ${INLINE_DATASET_MAX_BYTES / 1024} KB`,
  ]
  expect(expected.filter((entry) => !prompt.includes(entry))).toEqual([])
})

test("the agent intent actions are exactly the catalog's agent-class actions", () => {
  const agentActions = Object.entries(GENUI_ACTIONS).filter(([, def]) => def.class === "agent").map(([name]) => name)
  const intentActions: string[] = [...AGENT_INTENT_ACTIONS]
  expect(intentActions.sort()).toEqual(agentActions.sort())
})
