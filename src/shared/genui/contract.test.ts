import { expect, test } from "bun:test"
import { z } from "zod"
import {
  GENUI_ACTIONS,
  GENUI_COMPONENTS,
  extractKannaUiFences,
  formatIntentMessage,
  parseGenUISpec,
  parseIntentMessage,
  renderGenUIPromptSection,
} from "./index"

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
