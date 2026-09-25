import { expect, test } from "bun:test"
import path from "node:path"
import { ESLint } from "eslint"

const ROOT = path.resolve(import.meta.dir, "../../..")
const CLIENT_FILE = path.join(ROOT, "src/client/app/App.tsx")
const eslint = new ESLint({ cwd: ROOT })

const PRELUDE = `
import { runPendingAction } from "../stores/pendingActionsStore"
declare function save(): Promise<void>
`

async function reportedRules(body: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${PRELUDE}${body}`, { filePath: CLIENT_FILE })
  return (result?.messages ?? []).map((message) => message.ruleId ?? "parse-error")
}

test("a promise discarded with void in a click handler fails lint", async () => {
  const rules = await reportedRules(`export const Row = () => <button onClick={() => void save()}>Save</button>\n`)
  expect(rules).toContain("@typescript-eslint/no-floating-promises")
}, 60_000)

test("an async function handed to a void-typed JSX prop fails lint", async () => {
  const rules = await reportedRules(`export const Row = () => <button onClick={save}>Save</button>\n`)
  expect(rules).toContain("@typescript-eslint/no-misused-promises")
}, 60_000)

test("a catch that discards the error fails lint", async () => {
  const rules = await reportedRules(`export function fire() { return save().catch(() => {}) }\n`)
  expect(rules).toContain("no-restricted-syntax")
}, 60_000)

test("launching through runPendingAction passes the promise rules", async () => {
  const rules = await reportedRules(
    `export const Row = () => <button onClick={() => runPendingAction("row.save", save)}>Save</button>\n`,
  )
  expect(rules).toEqual([])
}, 60_000)
