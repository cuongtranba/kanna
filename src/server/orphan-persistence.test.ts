import { describe, it, expect, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "bun"
import {
  writeOrphans,
  readOrphans,
  isAlive,
  recoverOrphans,
  type PersistedTask,
} from "./orphan-persistence"
import { BackgroundTaskRegistry } from "./background-tasks"

const TEST_PORT = 49_999

function makeTasks(overrides: Partial<PersistedTask>[] = []): PersistedTask[] {
  const base: PersistedTask = {
    id: "t1",
    pid: process.pid,
    command: "bun",
    chatId: "chat-1",
    startedAt: 1_700_000_000_000,
  }
  if (overrides.length === 0) return [base]
  return overrides.map((o, i) => ({ ...base, id: `t${i + 1}`, ...o }))
}

let tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orphan-test-"))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true, force: true })
  }
  tmpDirs = []
})

describe("orphan persistence", () => {
  it("write then read round-trips entries", async () => {
    const stateDir = await makeTmpDir()
    const tasks = makeTasks([
      { id: "a", pid: process.pid, command: "echo", chatId: "chat-a", startedAt: 1_000 },
      { id: "b", pid: process.pid + 1, command: "sleep", chatId: null, startedAt: 2_000 },
    ])
    await writeOrphans(TEST_PORT, tasks, { stateDir })
    const result = await readOrphans(TEST_PORT, { stateDir })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: "a", command: "echo", chatId: "chat-a" })
    expect(result[1]).toMatchObject({ id: "b", command: "sleep", chatId: null })
  })

  it("drops dead pids on read via isAlive", async () => {
    // Spawn a child, capture its pid, wait for it to die, then verify isAlive = false
    const child = spawn({
      cmd: ["bun", "-e", "process.exit(0)"],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    const childPid = child.pid!
    await child.exited

    expect(isAlive(process.pid)).toBe(true)
    expect(isAlive(childPid)).toBe(false)

    // recoverOrphans should skip the dead pid
    const stateDir = await makeTmpDir()
    const tasks = makeTasks([
      { id: "live", pid: process.pid, command: "bun", chatId: "c1", startedAt: 1_000 },
      { id: "dead", pid: childPid, command: "bun", chatId: "c2", startedAt: 2_000 },
    ])
    await writeOrphans(TEST_PORT, tasks, { stateDir })
    const registry = new BackgroundTaskRegistry()
    const kept = await recoverOrphans(registry, TEST_PORT, { stateDir })
    // Only the live pid should have been registered
    expect(kept).toBe(1)
    const entries = registry.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: "live", orphan: true })
  })

  it("returns empty on corrupted JSON without throwing", async () => {
    const stateDir = await makeTmpDir()
    await mkdir(stateDir, { recursive: true })
    const filePath = path.join(stateDir, `orphan-pids-${TEST_PORT}.json`)
    await writeFile(filePath, "{ not valid json !!!", "utf8")
    const result = await readOrphans(TEST_PORT, { stateDir })
    expect(result).toEqual([])
  })

  it("atomic write: temp file is renamed to final file", async () => {
    const stateDir = await makeTmpDir()
    const tasks = makeTasks()
    await writeOrphans(TEST_PORT, tasks, { stateDir })
    // Final file must exist and be valid JSON
    const result = await readOrphans(TEST_PORT, { stateDir })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("t1")

    // No leftover .tmp files
    const { readdirSync } = await import("node:fs")
    const entries = readdirSync(stateDir)
    const tmpFiles = entries.filter((f) => f.endsWith(".tmp"))
    expect(tmpFiles).toHaveLength(0)
  })
})
