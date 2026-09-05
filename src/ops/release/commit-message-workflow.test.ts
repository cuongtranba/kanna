import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"


const ROOT = join(import.meta.dir, "../../..")
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8")
const HOOK = readFileSync(join(ROOT, ".githooks/commit-msg"), "utf8")
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>
}

describe("the CI job actually checks something", () => {
  test("the commit-message job exists and runs the gate", () => {
    expect(WORKFLOW).toContain("commit-messages:")
    expect(WORKFLOW).toContain("bun run check:commits")
  })

  test("it checks out full history", () => {
    expect(WORKFLOW).toContain("fetch-depth: 0")
  })

  test("it checks the PR title as well as the commits", () => {
    expect(WORKFLOW).toContain("--title")
    expect(WORKFLOW).toContain("--range")
  })

  test("the PR title never reaches the shell through an interpolation", () => {
    expect(WORKFLOW).toContain("PR_TITLE: ${{ github.event.pull_request.title }}")
    expect(WORKFLOW).not.toContain('--title "${{')
  })
})

describe("the local hook", () => {
  test("runs the same gate on the message being written", () => {
    expect(HOOK).toContain("check-commit-messages.ts")
    expect(HOOK).toContain("--file")
  })

  test("stands down rather than blocking a commit when bun is missing", () => {
    expect(HOOK).toContain("command -v bun")
    expect(HOOK).toContain("exit 0")
  })
})

describe("the script entry", () => {
  test("check:commits is defined", () => {
    expect(PACKAGE.scripts["check:commits"]).toContain("check-commit-messages.ts")
  })
})
