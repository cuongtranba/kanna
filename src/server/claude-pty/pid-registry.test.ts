import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ClaudePtyRegistry } from "./pid-registry"

let tempDir = ""
let registryPath = ""

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "kanna-claude-pty-registry-"))
  registryPath = path.join(tempDir, "claude-pty.json")
})

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe("ClaudePtyRegistry", () => {
  test("register persists entries with sessionId, pid, cwd, runtimeDir", async () => {
    const registry = new ClaudePtyRegistry(registryPath)
    await registry.register({ chatId: "c1", sessionId: "s1", pid: 12345, cwd: "/tmp/a", runtimeDir: "/tmp/r1" })
    await registry.register({ chatId: "c2", sessionId: "s2", pid: 23456, cwd: "/tmp/b", runtimeDir: "/tmp/r2" })

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as {
      entries: Array<{ chatId: string; sessionId: string; pid: number; runtimeDir: string }>
    }
    expect(raw.entries).toHaveLength(2)
    expect(raw.entries[0]).toMatchObject({ chatId: "c1", sessionId: "s1", pid: 12345, cwd: "/tmp/a", runtimeDir: "/tmp/r1" })
    expect(raw.entries[1]).toMatchObject({ chatId: "c2", sessionId: "s2", pid: 23456, cwd: "/tmp/b", runtimeDir: "/tmp/r2" })
  })

  test("re-registering the same sessionId replaces the prior entry", async () => {
    const registry = new ClaudePtyRegistry(registryPath)
    await registry.register({ chatId: "c1", sessionId: "s1", pid: 100, cwd: "/tmp/old", runtimeDir: "/tmp/r-old" })
    await registry.register({ chatId: "c1", sessionId: "s1", pid: 200, cwd: "/tmp/new", runtimeDir: "/tmp/r-new" })

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as { entries: Array<{ pid: number }> }
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0]?.pid).toBe(200)
  })

  test("unregister removes only the matching sessionId", async () => {
    const registry = new ClaudePtyRegistry(registryPath)
    await registry.register({ chatId: "c1", sessionId: "s1", pid: 1, cwd: "/tmp/a", runtimeDir: "/tmp/r1" })
    await registry.register({ chatId: "c2", sessionId: "s2", pid: 2, cwd: "/tmp/b", runtimeDir: "/tmp/r2" })
    await registry.unregister("s1")

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as { entries: Array<{ sessionId: string }> }
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0]?.sessionId).toBe("s2")
  })

  test("reapStale kills live process groups, removes runtimeDirs, and clears the file", async () => {
    const child = Bun.spawn(
      ["python3", "-c", "import os, sys, time; os.setsid(); sys.stdout.write('ready\\n'); sys.stdout.flush(); time.sleep(60)"],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    )
    const reader = child.stdout.getReader()
    const decoded = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array())
    expect(decoded).toContain("ready")
    reader.releaseLock()
    const childPid = child.pid

    const runtimeDir = path.join(tempDir, "spawn-runtime")
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(runtimeDir, "mcp-config.json"), "{}", "utf8")

    await writeFile(
      registryPath,
      JSON.stringify({
        entries: [
          { chatId: "c1", sessionId: "s1", pid: childPid, cwd: "/tmp/a", runtimeDir, createdAt: Date.now() },
          { chatId: "c2", sessionId: "s2", pid: 999_999_999, cwd: "/tmp/b", runtimeDir: "/tmp/nonexistent", createdAt: Date.now() },
        ],
      }),
      "utf8",
    )

    const registry = new ClaudePtyRegistry(registryPath)
    const reaped = await registry.reapStale()

    expect(reaped.map((entry) => entry.sessionId).sort()).toEqual(["s1", "s2"])

    const exited = await Promise.race([
      child.exited,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000)),
    ])
    expect(exited).not.toBe("timeout")
    expect(child.signalCode).toBe("SIGKILL")
    void childPid

    // runtimeDir cleaned up
    await expect(stat(runtimeDir)).rejects.toThrow()

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as { entries: unknown[] }
    expect(raw.entries).toEqual([])
  }, 30_000)

  test("reapStale tolerates a missing registry file", async () => {
    const registry = new ClaudePtyRegistry(registryPath)
    const reaped = await registry.reapStale()
    expect(reaped).toEqual([])
  })

  test("reapStale tolerates a malformed registry file", async () => {
    await writeFile(registryPath, "not json", "utf8")
    const registry = new ClaudePtyRegistry(registryPath)
    const reaped = await registry.reapStale()
    expect(reaped).toEqual([])
  })

  test("register creates the parent directory if missing", async () => {
    const nestedPath = path.join(tempDir, "nested", "deep", "claude-pty.json")
    const registry = new ClaudePtyRegistry(nestedPath)
    await registry.register({ chatId: "c1", sessionId: "s1", pid: 1, cwd: "/tmp/a", runtimeDir: "/tmp/r1" })
    const raw = JSON.parse(await readFile(nestedPath, "utf8")) as { entries: unknown[] }
    expect(raw.entries).toHaveLength(1)
  })
})
