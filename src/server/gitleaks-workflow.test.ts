import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "gitleaks.yml")
const PINNED_IMAGE = "zricethezav/gitleaks:v8.30.1"

describe("gitleaks workflow", () => {
  test(".github/workflows/gitleaks.yml exists", () => {
    expect(() => readFileSync(WORKFLOW_PATH, "utf8")).not.toThrow()
  })

  test("triggers on push to main", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("push:")
    expect(source).toContain("main")
  })

  test("triggers on pull_request to main", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("pull_request:")
  })

  test("triggers on workflow_dispatch", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("workflow_dispatch:")
  })

  test("has explicit minimal permissions (contents: read, security-events: write)", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("contents: read")
    expect(source).toContain("security-events: write")
  })

  test("checkout step uses fetch-depth: 0 for full history scan", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("fetch-depth: 0")
  })

  test("uses pinned gitleaks image (not :latest)", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain(PINNED_IMAGE)
    expect(source).not.toContain("gitleaks:latest")
  })

  test("passes --redact flag to gitleaks invocation", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("--redact")
  })

  test("uploads SARIF report", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("upload-sarif")
    expect(source).toContain("sarif")
  })

  test("SARIF upload step uses if: always() so it runs even on scan failure", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    expect(source).toContain("if: always()")
  })

  test("uses gitleaks git subcommand (history scan, not working-tree dir scan)", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8")
    const usesGitSubcommand = source.includes("gitleaks git") || /gitleaks:\S+\s+git\b/.test(source)
    expect(usesGitSubcommand).toBe(true)
  })
})
