import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The gate's wiring, pinned.
 *
 * Every failure mode here is silent: a shallow checkout leaves the range empty
 * and the job passes having checked nothing, a dropped `--title` stops covering
 * the squash SUBJECT (which is exactly what release-please reads first), and a
 * `${{ }}` interpolation of a fork PR's title puts attacker-controlled text
 * into a shell. None of those turn the job red on their own.
 */

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
    // With the shallow default the range resolves to nothing and the job is
    // green having verified no commits at all.
    expect(WORKFLOW).toContain("fetch-depth: 0")
  })

  test("it checks the PR title as well as the commits", () => {
    // A squash lands the PR title as the subject line. Checking only the
    // commits would leave the one line release-please reads first uncovered.
    expect(WORKFLOW).toContain("--title")
    expect(WORKFLOW).toContain("--range")
  })

  test("the PR title never reaches the shell through an interpolation", () => {
    // A fork PR's title is attacker-controlled. It must arrive as an env var.
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
    // Same posture as the gitleaks pre-commit hook: local tooling absence is
    // not a reason to refuse a commit, because CI still enforces it.
    expect(HOOK).toContain("command -v bun")
    expect(HOOK).toContain("exit 0")
  })
})

describe("the script entry", () => {
  test("check:commits is defined", () => {
    expect(PACKAGE.scripts["check:commits"]).toContain("check-commit-messages.ts")
  })
})
