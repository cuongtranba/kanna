import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { computeJsonlPath, computeProjectDir, computeWorkflowsDir, encodeCwd } from "./jsonl-path.adapter"

describe("encodeCwd", () => {
  test("absolute path: replaces / with -", () => {
    const expected = homedir().replace(/[^a-zA-Z0-9]/g, "-")
    expect(encodeCwd(homedir())).toBe(expected)
  })
  test("absolute path with trailing slash: trims it", () => {
    const expected = homedir().replace(/[^a-zA-Z0-9]/g, "-")
    expect(encodeCwd(`${homedir()  }/`)).toBe(expected)
  })
  test("nested path", () => {
    const expected = process.cwd().replace(/[^a-zA-Z0-9]/g, "-")
    expect(encodeCwd(process.cwd())).toBe(expected)
  })
  test("root path", () => {
    expect(encodeCwd("/")).toBe("-")
  })
})

describe("computeJsonlPath", () => {
  test("combines homeDir + encoded cwd + session uuid", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-jsonlpath-"))
    try {
      const realPath = realpathSync(tmp)
      const encodedCwd = realPath.replace(/[^a-zA-Z0-9]/g, "-")
      const result = computeJsonlPath({
        homeDir: "/home/u",
        cwd: tmp,
        sessionId: "abc-123",
      })
      expect(result).toBe(`/home/u/.claude/projects/${encodedCwd}/abc-123.jsonl`)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("encodeCwd realpath + dot replacement", () => {
  test("resolves macOS /var -> /private/var symlink", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-encodecwd-"))
    try {
      const encoded = encodeCwd(tmp)
      const realPath = realpathSync(tmp)
      const expectedEncoded = realPath.replace(/[^a-zA-Z0-9]/g, "-")
      expect(encoded).toBe(expectedEncoded)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test("replaces dots with dashes in segment names", async () => {
    // mkdtemp ensures the directory exists so realpathSync succeeds
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna.dot-test-"))
    try {
      const encoded = encodeCwd(tmp)
      expect(encoded).not.toContain(".")
      // The "kanna.dot-test-XXXX" segment dot must be replaced
      expect(encoded).toContain("kanna-dot-test-")
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test("trailing slash trimmed before encoding", () => {
    const a = encodeCwd("/etc/")
    const b = encodeCwd("/etc")
    expect(a).toBe(b)
  })

  test("root / encodes to single dash", () => {
    const result = encodeCwd("/")
    expect(result).toBe("-")
  })

  test("replaces underscore with dash (claude sanitizePath parity)", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna_under_"))
    try {
      const encoded = encodeCwd(tmp)
      expect(encoded).not.toContain("_")
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test("encoded segment matches /[^a-zA-Z0-9-]/ never present", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-charset-"))
    try {
      const encoded = encodeCwd(tmp)
      expect(encoded).toMatch(/^[a-zA-Z0-9-]+$/)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("computeWorkflowsDir", () => {
  test("computeWorkflowsDir = <projectDir>/<sessionId>/workflows", () => {
    const cwd = process.cwd() // existing dir; realpathSync requires it to exist
    const sessionId = "11111111-2222-3333-4444-555555555555"
    const expected = `${computeProjectDir({ homeDir: "/home/x", cwd })}/${sessionId}/workflows`
    expect(computeWorkflowsDir({ homeDir: "/home/x", cwd, sessionId })).toBe(expected)
  })
})

describe("computeProjectDir", () => {
  test("returns .claude/projects/<encodedCwd> path", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-projdir-"))
    try {
      const realPath = realpathSync(tmp)
      const encodedCwd = realPath.replace(/[^a-zA-Z0-9]/g, "-")
      const result = computeProjectDir({ homeDir: "/home/user", cwd: tmp })
      expect(result).toBe(`/home/user/.claude/projects/${encodedCwd}`)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
