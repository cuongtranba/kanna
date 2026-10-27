import { afterAll, beforeAll, expect, test } from "vite-plus/test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { runOxlint } from "../lint/oxlint-run.adapter"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const SNIPPET_DIR = path.join(ROOT, "src/client/app/__pending_gate_tmp__")

const PRELUDE = `
import { runPendingAction } from "../../stores/pendingActionsStore"
declare function save(): Promise<void>
`

const SNIPPETS = {
  voidClick: `export const Row = () => <button onClick={() => void save()}>Save</button>\n`,
  voidStatement: `export function fire() { void save() }\n`,
  asyncAttribute: `export const Row = () => <button onClick={save}>Save</button>\n`,
  silentCatch: `export function fire() { return save().catch(() => {}) }\n`,
  pendingAction: `export const Row = () => <button onClick={() => runPendingAction("row.save", save)}>Save</button>\n`,
}

type SnippetName = keyof typeof SNIPPETS

const fileOf = (name: SnippetName): string => path.join(SNIPPET_DIR, `${name}.tsx`)

let reported: ReadonlyMap<SnippetName, string[]>

beforeAll(() => {
  mkdirSync(SNIPPET_DIR, { recursive: true })
  const names = Object.keys(SNIPPETS).filter((name): name is SnippetName => name in SNIPPETS)
  for (const name of names) writeFileSync(fileOf(name), `${PRELUDE}${SNIPPETS[name]}`)
  const diagnostics = runOxlint(ROOT, names.map((name) => path.relative(ROOT, fileOf(name))))
  reported = new Map(
    names.map((name) => [
      name,
      diagnostics.filter((d) => path.resolve(ROOT, d.filename) === fileOf(name)).map((d) => d.rule),
    ]),
  )
}, 180_000)

afterAll(() => {
  rmSync(SNIPPET_DIR, { recursive: true, force: true })
})

test("a promise discarded with void in a click handler fails lint", () => {
  expect(reported.get("voidClick")).toContain("eslint-js/no-restricted-syntax")
})

test("a promise discarded with void in a statement fails lint", () => {
  expect(reported.get("voidStatement")).toContain("typescript/no-floating-promises")
})

test("an async function handed to a void-typed JSX prop fails lint", () => {
  expect(reported.get("asyncAttribute")).toContain("typescript/no-misused-promises")
})

test("a catch that discards the error fails lint", () => {
  expect(reported.get("silentCatch")).toContain("eslint-js/no-restricted-syntax")
})

test("launching through runPendingAction passes the promise rules", () => {
  expect(reported.get("pendingAction")).toEqual([])
})
