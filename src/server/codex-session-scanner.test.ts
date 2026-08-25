import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { locateCodexRolloutFile, scanCodexRollouts } from "./codex-session-scanner.adapter"

function withTempHome<T>(run: (homeDir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-scanner-"))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function sessionsDir(homeDir: string): string {
  return path.join(homeDir, ".codex", "sessions")
}

function writeAt(homeDir: string, relative: string, body = "{}\n"): string {
  const full = path.join(sessionsDir(homeDir), relative)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, body)
  return full
}

const ID_A = "019fe1f6-b759-7f10-8e11-171db6cdc3fa"
const ID_B = "019f979e-06aa-74c2-8eb8-84936fb88b82"

describe("scanCodexRollouts", () => {
  test("walks YYYY/MM/DD and returns only rollout-*.jsonl", () => {
    withTempHome((home) => {
      const a = writeAt(home, `2026/08/08/rollout-2026-08-08T22-21-10-${ID_A}.jsonl`)
      const b = writeAt(home, `2026/07/25/rollout-2026-07-25T11-52-23-${ID_B}.jsonl`)
      // Not rollouts: the sessions root also holds unrelated JSONL.
      writeAt(home, "responders-codex-1780497744913.jsonl")
      writeAt(home, "2026/08/08/notes.txt")
      writeAt(home, "2026/08/08/session_index.jsonl")

      expect(scanCodexRollouts(home).sort()).toEqual([a, b].sort())
    })
  })

  test("returns empty when ~/.codex or sessions/ is missing", () => {
    withTempHome((home) => {
      expect(scanCodexRollouts(home)).toEqual([])
      mkdirSync(path.join(home, ".codex"), { recursive: true })
      expect(scanCodexRollouts(home)).toEqual([])
    })
  })

  test("is deterministic — repeated scans return the same order", () => {
    withTempHome((home) => {
      writeAt(home, `2026/08/08/rollout-2026-08-08T22-21-10-${ID_A}.jsonl`)
      writeAt(home, `2026/07/25/rollout-2026-07-25T11-52-23-${ID_B}.jsonl`)
      writeAt(home, "2026/01/02/rollout-2026-01-02T00-00-00-cccccccc.jsonl")

      expect(scanCodexRollouts(home)).toEqual(scanCodexRollouts(home))
    })
  })
})

describe("locateCodexRolloutFile", () => {
  test("finds a session by the uuid tail of the basename", () => {
    withTempHome((home) => {
      const a = writeAt(home, `2026/08/08/rollout-2026-08-08T22-21-10-${ID_A}.jsonl`)
      writeAt(home, `2026/07/25/rollout-2026-07-25T11-52-23-${ID_B}.jsonl`)

      expect(locateCodexRolloutFile(home, ID_A)).toBe(a)
    })
  })

  test("returns null for an unknown id, an empty id, and a missing home", () => {
    withTempHome((home) => {
      writeAt(home, `2026/08/08/rollout-2026-08-08T22-21-10-${ID_A}.jsonl`)

      expect(locateCodexRolloutFile(home, "no-such-session")).toBeNull()
      expect(locateCodexRolloutFile(home, "")).toBeNull()
      expect(locateCodexRolloutFile(path.join(home, "nowhere"), ID_A)).toBeNull()
    })
  })

  test("ignores a non-rollout jsonl that happens to end with the id", () => {
    withTempHome((home) => {
      writeAt(home, `2026/08/08/responders-codex-${ID_A}.jsonl`)

      expect(locateCodexRolloutFile(home, ID_A)).toBeNull()
    })
  })

  test("opens no file — an unopenable rollout is still located, a rollout-named DIRECTORY is not", () => {
    withTempHome((home) => {
      // Mode 0o000: perfectly readable as a DIRENT, unopenable as a file. An
      // implementation that read line 1 to confirm the id would throw EACCES.
      const unopenable = writeAt(home, `2026/01/02/rollout-2026-01-02T00-00-00-${ID_B}.jsonl`)
      chmodSync(unopenable, 0o000)

      // A DIRECTORY whose name matches the rollout pattern. Opening it throws
      // EISDIR for every user, root included.
      const trap = path.join(sessionsDir(home), "2026", "08", "08", `rollout-2026-08-08T00-00-00-${ID_A}.jsonl`)
      mkdirSync(trap, { recursive: true })

      expect(locateCodexRolloutFile(home, ID_B)).toBe(unopenable)
      expect(locateCodexRolloutFile(home, ID_A)).toBeNull()
      expect(scanCodexRollouts(home)).toEqual([unopenable])

      chmodSync(unopenable, 0o644)
    })
  })
})
