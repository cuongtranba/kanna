import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TerminalPidRegistry } from "./terminal-pid-registry"

let tempDir = ""
let registryPath = ""

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "kanna-terminal-registry-"))
  registryPath = path.join(tempDir, "terminals.json")
})

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe("TerminalPidRegistry", () => {
  test("register persists entries to disk", async () => {
    const registry = new TerminalPidRegistry(registryPath)
    await registry.register({ terminalId: "t1", pid: 12345, cwd: "/tmp/a" })
    await registry.register({ terminalId: "t2", pid: 23456, cwd: "/tmp/b" })

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as {
      entries: Array<{ terminalId: string; pid: number; cwd: string }>
    }
    expect(raw.entries).toHaveLength(2)
    expect(raw.entries[0]).toMatchObject({ terminalId: "t1", pid: 12345, cwd: "/tmp/a" })
    expect(raw.entries[1]).toMatchObject({ terminalId: "t2", pid: 23456, cwd: "/tmp/b" })
  })

  test("unregister removes entry and persists", async () => {
    const registry = new TerminalPidRegistry(registryPath)
    await registry.register({ terminalId: "t1", pid: 1, cwd: "/tmp/a" })
    await registry.register({ terminalId: "t2", pid: 2, cwd: "/tmp/b" })
    await registry.unregister("t1")

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as {
      entries: Array<{ terminalId: string }>
    }
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0]?.terminalId).toBe("t2")
  })

  test("reapStale kills live process groups and clears the file", async () => {
    // Spawn a process that becomes its own pgroup leader (mirrors how
    // PTY-allocated shells in TerminalManager have pid == pgid). The
    // ready handshake ensures setsid() has run before we attempt to reap.
    const child = Bun.spawn(
      ["python3", "-c", "import os, sys, time; os.setsid(); sys.stdout.write('ready\\n'); sys.stdout.flush(); time.sleep(60)"],
      { stdout: "pipe", stderr: "ignore" },
    )
    const reader = child.stdout.getReader()
    const decoded = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array())
    expect(decoded).toContain("ready")
    reader.releaseLock()
    const childPid = child.pid

    await writeFile(
      registryPath,
      JSON.stringify({
        entries: [
          { terminalId: "t1", pid: childPid, cwd: "/tmp/a", createdAt: Date.now() },
          { terminalId: "t2", pid: 999_999_999, cwd: "/tmp/b", createdAt: Date.now() },
        ],
      }),
      "utf8",
    )

    const registry = new TerminalPidRegistry(registryPath)
    const reaped = await registry.reapStale()

    expect(reaped.map((entry) => entry.terminalId).sort()).toEqual(["t1", "t2"])

    // Wait for the kernel to reap the killed child.
    const exitedWithTimeout = await Promise.race([
      child.exited,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000)),
    ])
    expect(exitedWithTimeout).not.toBe("timeout")
    expect(child.signalCode).toBe("SIGKILL")
    void childPid // pid retained for clarity; assertion is on the subprocess handle

    const raw = JSON.parse(await readFile(registryPath, "utf8")) as { entries: unknown[] }
    expect(raw.entries).toEqual([])
  })

  test("reapStale tolerates a missing registry file", async () => {
    const registry = new TerminalPidRegistry(registryPath)
    const reaped = await registry.reapStale()
    expect(reaped).toEqual([])
  })

  test("reapStale tolerates a malformed registry file", async () => {
    await writeFile(registryPath, "not json", "utf8")
    const registry = new TerminalPidRegistry(registryPath)
    const reaped = await registry.reapStale()
    expect(reaped).toEqual([])
  })

  test("register creates the parent directory if missing", async () => {
    const nestedPath = path.join(tempDir, "nested", "deep", "terminals.json")
    const registry = new TerminalPidRegistry(nestedPath)
    await registry.register({ terminalId: "t1", pid: 1, cwd: "/tmp/a" })
    const raw = JSON.parse(await readFile(nestedPath, "utf8")) as { entries: unknown[] }
    expect(raw.entries).toHaveLength(1)
  })
})
