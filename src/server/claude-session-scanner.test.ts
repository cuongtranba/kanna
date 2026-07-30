import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { locateClaudeSessionFile, scanClaudeSessions } from "./claude-session-scanner.adapter"

function makeTempClaudeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(tmpdir(), "kanna-claude-home-"))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

describe("scanClaudeSessions", () => {
  test("returns empty list when ~/.claude/projects missing", () => {
    const { home, cleanup } = makeTempClaudeHome()
    try {
      expect(scanClaudeSessions(home)).toEqual([])
    } finally {
      cleanup()
    }
  })

  test("discovers session files inside project folders", () => {
    const { home, cleanup } = makeTempClaudeHome()
    try {
      const realProj = mkdtempSync(path.join(tmpdir(), "kanna-proj-"))
      const folderName = realProj.replace(/\//g, "-")
      const projDir = path.join(home, ".claude", "projects", folderName)
      mkdirSync(projDir, { recursive: true })
      const sessionPath = path.join(projDir, "sess-abc.jsonl")
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-abc",
        cwd: realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: { role: "user", content: "hi" },
      })
      writeFileSync(sessionPath, `${line}\n`, "utf8")

      const sessions = scanClaudeSessions(home)
      expect(sessions.length).toBe(1)
      expect(sessions[0].sessionId).toBe("sess-abc")
      expect(sessions[0].filePath).toBe(sessionPath)
      rmSync(realProj, { recursive: true, force: true })
    } finally {
      cleanup()
    }
  })
})

describe("locateClaudeSessionFile", () => {
  test("finds the file in any project dir", () => {
    const { home, cleanup } = makeTempClaudeHome()
    try {
      const dirA = path.join(home, ".claude", "projects", "dir-a")
      const dirB = path.join(home, ".claude", "projects", "dir-b")
      mkdirSync(dirA, { recursive: true })
      mkdirSync(dirB, { recursive: true })
      writeFileSync(path.join(dirA, "other.jsonl"), "{}\n", "utf8")
      const target = path.join(dirB, "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f.jsonl")
      writeFileSync(target, "{}\n", "utf8")

      const found = locateClaudeSessionFile(home, "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f")
      expect(found).toBe(target)
    } finally {
      cleanup()
    }
  })

  test("returns null when absent or projects dir missing", () => {
    const { home, cleanup } = makeTempClaudeHome()
    try {
      expect(locateClaudeSessionFile(home, "00000000-0000-4000-8000-000000000000")).toBeNull()
      expect(locateClaudeSessionFile(path.join(home, "nope"), "00000000-0000-4000-8000-000000000000")).toBeNull()
    } finally {
      cleanup()
    }
  })
})
