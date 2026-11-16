import { afterAll, beforeAll, expect, test } from "vite-plus/test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runOxlint } from "../lint/oxlint-run.adapter"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const LINT_ROOT = mkdtempSync(path.join(tmpdir(), "kanna-pending-gate-"))
const SNIPPET_DIR = path.join(LINT_ROOT, "src/client/app")

const PRELUDE = `
import { runPendingAction } from "../stores/pendingActionsStore"
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

function mirrorLintSetup(): void {
  mkdirSync(SNIPPET_DIR, { recursive: true })
  symlinkSync(path.join(ROOT, "node_modules"), path.join(LINT_ROOT, "node_modules"), "dir")
  symlinkSync(path.join(ROOT, "src/client/stores"), path.join(LINT_ROOT, "src/client/stores"), "dir")
  writeFileSync(path.join(LINT_ROOT, "package.json"), JSON.stringify({ name: "pending-gate", private: true, type: "module" }))
  writeFileSync(path.join(LINT_ROOT, "vite.config.ts"), `export { default } from ${JSON.stringify(path.join(ROOT, "vite.config.ts"))}\n`)
  writeFileSync(
    path.join(LINT_ROOT, "tsconfig.json"),
    JSON.stringify({ extends: path.join(ROOT, "tsconfig.json"), include: ["src/**/*.tsx"] }),
  )
}

let reported: ReadonlyMap<SnippetName, string[]>

beforeAll(() => {
  mirrorLintSetup()
  const names = Object.keys(SNIPPETS).filter((name): name is SnippetName => name in SNIPPETS)
  for (const name of names) writeFileSync(fileOf(name), `${PRELUDE}${SNIPPETS[name]}`)
  const diagnostics = runOxlint(LINT_ROOT, names.map((name) => path.relative(LINT_ROOT, fileOf(name))))
  reported = new Map(
    names.map((name) => [
      name,
      diagnostics.filter((d) => path.resolve(LINT_ROOT, d.filename) === fileOf(name)).map((d) => d.rule),
    ]),
  )
}, 180_000)

afterAll(() => {
  rmSync(LINT_ROOT, { recursive: true, force: true })
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
