import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { locateCodexRolloutFile, scanCodexSessions } from "./codex-session-scanner.adapter"

function makeTempCodexHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(tmpdir(), "kanna-codex-home-"))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

function writeRollout(dir: string, sessionId: string, date = "2026-07-25T13-43-04"): string {
  mkdirSync(dir, { recursive: true })
  const filename = `rollout-${date}-${sessionId}.jsonl`
  const filePath = path.join(dir, filename)
  writeFileSync(filePath, `{"type":"session_meta"}\n`, "utf8")
  return filePath
}

describe("scanCodexSessions", () => {
  test("returns empty list when ~/.codex/sessions is missing", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      expect(scanCodexSessions(home)).toEqual([])
    } finally {
      cleanup()
    }
  })

  test("collects all .jsonl files from year/month subdirectories", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      const monthDir = path.join(home, ".codex", "sessions")
      const dir1 = path.join(monthDir, "2026", "07")
      const id1 = "019f9803-5abf-7811-9f59-9b63c088c3fa"
      const id2 = "019f97ef-5a2b-7bb0-8120-dff99eae3536"
      const p1 = writeRollout(dir1, id1)
      const p2 = writeRollout(dir1, id2, "2026-07-26T10-00-00")

      expect(scanCodexSessions(home).sort()).toEqual([p1, p2].sort())
    } finally {
      cleanup()
    }
  })

  test("skips non-.jsonl files", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      const monthDir = path.join(home, ".codex", "sessions", "2026", "07")
      mkdirSync(monthDir, { recursive: true })
      writeFileSync(path.join(monthDir, "notes.txt"), "ignore me", "utf8")
      const id = "019f9803-5abf-7811-9f59-9b63c088c3fa"
      const p = writeRollout(monthDir, id)

      expect(scanCodexSessions(home)).toEqual([p])
    } finally {
      cleanup()
    }
  })
})

describe("scanCodexSessions ENOENT vs EACCES handling", () => {
  let home: string
  let cleanup: () => void
  let accessiblePath: string
  let inaccessibleDir: string

  beforeAll(() => {
    const tmp = makeTempCodexHome()
    home = tmp.home
    cleanup = () => {
      chmodSync(inaccessibleDir, 0o755)
      tmp.cleanup()
    }

    const sessDir = path.join(home, ".codex", "sessions")
    const accessibleMonth = path.join(sessDir, "2026", "07")
    inaccessibleDir = path.join(sessDir, "2026", "06")

    accessiblePath = writeRollout(accessibleMonth, "019f9803-5abf-7811-9f59-9b63c088c3fa")
    writeRollout(inaccessibleDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    chmodSync(inaccessibleDir, 0o000)
  })

  afterAll(() => cleanup())

  test("returns accessible files when a sibling directory is inaccessible", () => {
    if (process.getuid?.() === 0) return
    const result = scanCodexSessions(home)
    expect(result).toContain(accessiblePath)
    expect(result.length).toBe(1)
  })

  test("does not throw when a directory is inaccessible", () => {
    if (process.getuid?.() === 0) return
    expect(() => scanCodexSessions(home)).not.toThrow()
  })
})

describe("locateCodexRolloutFile", () => {
  test("finds a rollout file by session id", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      const monthDir = path.join(home, ".codex", "sessions", "2026", "07")
      const sessionId = "019f9803-5abf-7811-9f59-9b63c088c3fa"
      const expected = writeRollout(monthDir, sessionId)

      expect(locateCodexRolloutFile(home, sessionId)).toBe(expected)
    } finally {
      cleanup()
    }
  })

  test("returns null when sessions directory is missing", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      expect(locateCodexRolloutFile(home, "019f9803-5abf-7811-9f59-9b63c088c3fa")).toBeNull()
    } finally {
      cleanup()
    }
  })

  test("returns null when no file matches the session id", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      const monthDir = path.join(home, ".codex", "sessions", "2026", "07")
      writeRollout(monthDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

      expect(locateCodexRolloutFile(home, "019f9803-5abf-7811-9f59-9b63c088c3fa")).toBeNull()
    } finally {
      cleanup()
    }
  })

  test("finds session across multiple year/month directories", () => {
    const { home, cleanup } = makeTempCodexHome()
    try {
      const dir1 = path.join(home, ".codex", "sessions", "2025", "12")
      const dir2 = path.join(home, ".codex", "sessions", "2026", "01")
      writeRollout(dir1, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
      const id = "019f9803-5abf-7811-9f59-9b63c088c3fa"
      const expected = writeRollout(dir2, id, "2026-01-15T10-00-00")

      expect(locateCodexRolloutFile(home, id)).toBe(expected)
    } finally {
      cleanup()
    }
  })
})
