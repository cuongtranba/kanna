import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  awaitClaudeSessionForPid,
  computeClaudeSessionFilePath,
  readClaudeSessionByPid,
} from "./claude-session-registry"

function makeHome(): string {
  return mkdtempSync(path.join(tmpdir(), "kanna-csr-"))
}

function writeEntry(homeDir: string, pid: number, body: Record<string, unknown>) {
  const dir = path.join(homeDir, ".claude", "sessions")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify(body), "utf8")
}

describe("computeClaudeSessionFilePath", () => {
  test("joins homeDir + .claude/sessions/<pid>.json", () => {
    expect(computeClaudeSessionFilePath("/tmp/h", 4242)).toBe("/tmp/h/.claude/sessions/4242.json")
  })
})

describe("readClaudeSessionByPid", () => {
  test("returns parsed entry when file exists with required fields", async () => {
    const home = makeHome()
    try {
      writeEntry(home, 1234, {
        pid: 1234,
        sessionId: "abc-uuid",
        cwd: "/some/cwd",
        kind: "interactive",
        startedAt: 1000,
      })
      const entry = await readClaudeSessionByPid(home, 1234)
      expect(entry).toEqual({
        pid: 1234,
        sessionId: "abc-uuid",
        cwd: "/some/cwd",
        kind: "interactive",
        startedAt: 1000,
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("returns null when file is missing", async () => {
    const home = makeHome()
    try {
      const entry = await readClaudeSessionByPid(home, 9999)
      expect(entry).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("returns null when sessionId is missing or empty", async () => {
    const home = makeHome()
    try {
      writeEntry(home, 1, { pid: 1, sessionId: "" })
      expect(await readClaudeSessionByPid(home, 1)).toBeNull()
      writeEntry(home, 2, { pid: 2 })
      expect(await readClaudeSessionByPid(home, 2)).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("returns null on malformed JSON", async () => {
    const home = makeHome()
    try {
      const dir = path.join(home, ".claude", "sessions")
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, "55.json"), "not-json", "utf8")
      expect(await readClaudeSessionByPid(home, 55)).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe("awaitClaudeSessionForPid", () => {
  test("returns immediately when file already exists", async () => {
    const home = makeHome()
    try {
      writeEntry(home, 77, { pid: 77, sessionId: "uuid-77" })
      const entry = await awaitClaudeSessionForPid({
        homeDir: home,
        pid: 77,
        timeoutMs: 200,
        pollIntervalMs: 5,
      })
      expect(entry?.sessionId).toBe("uuid-77")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("polls until file appears within timeout", async () => {
    const home = makeHome()
    try {
      setTimeout(() => writeEntry(home, 88, { pid: 88, sessionId: "uuid-88" }), 40)
      const entry = await awaitClaudeSessionForPid({
        homeDir: home,
        pid: 88,
        timeoutMs: 500,
        pollIntervalMs: 5,
      })
      expect(entry?.sessionId).toBe("uuid-88")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("returns null after timeout", async () => {
    const home = makeHome()
    try {
      const entry = await awaitClaudeSessionForPid({
        homeDir: home,
        pid: 99,
        timeoutMs: 50,
        pollIntervalMs: 5,
      })
      expect(entry).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("rejects mismatched pid in registry payload", async () => {
    const home = makeHome()
    try {
      writeEntry(home, 100, { pid: 999, sessionId: "wrong-pid" })
      const entry = await awaitClaudeSessionForPid({
        homeDir: home,
        pid: 100,
        timeoutMs: 30,
        pollIntervalMs: 5,
      })
      expect(entry).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
