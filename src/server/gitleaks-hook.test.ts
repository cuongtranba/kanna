import { describe, expect, test } from "bun:test"
import { existsSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "../..")
const HOOK_PATH = join(REPO_ROOT, ".githooks/pre-commit")

describe("gitleaks pre-commit hook", () => {
  test("hook file exists at .githooks/pre-commit", () => {
    expect(existsSync(HOOK_PATH)).toBe(true)
  })

  test("hook file is executable", () => {
    const mode = statSync(HOOK_PATH).mode
    // owner execute bit (0o100)
    expect(mode & 0o100).toBe(0o100)
  })

  test("hook uses git --staged subcommand, not the removed gitleaks protect", () => {
    const content = readFileSync(HOOK_PATH, "utf-8")
    expect(content).toContain("git --staged")
    expect(content).not.toContain("gitleaks protect")
  })

  test("hook exits 0 when gitleaks and docker are absent (soft-fail path)", () => {
    const content = readFileSync(HOOK_PATH, "utf-8")
    expect(content).toContain("exit 0")
    expect(content).toContain("gitleaks not installed")
  })

  test("hook uses --no-banner and --redact flags", () => {
    const content = readFileSync(HOOK_PATH, "utf-8")
    expect(content).toContain("--no-banner")
    expect(content).toContain("--redact")
  })
})
