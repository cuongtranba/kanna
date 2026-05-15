import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runSandboxPreflight } from "./preflight"
import { POLICY_DEFAULT } from "../../../shared/permission-policy"

describe("runSandboxPreflight (cross-platform)", () => {
  test("macOS: ok when sentinel denied", async () => {
    if (process.platform !== "darwin") return
    const home = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-mac-"))
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-runtime-"))
    try {
      await mkdir(path.join(home, ".ssh"), { recursive: true })
      await writeFile(path.join(home, ".ssh", "id_rsa"), "SECRET", "utf8")
      const policy = { ...POLICY_DEFAULT, readPathDeny: [`${home}/.ssh`] }
      const result = await runSandboxPreflight({
        platform: "darwin",
        enabled: true,
        policy,
        homeDir: home,
        runtimeDir,
        sentinelPath: `${home}/.ssh/id_rsa`,
      })
      expect(result.ok).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(runtimeDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("linux: ok when sentinel denied via bwrap tmpfs", async () => {
    if (process.platform !== "linux") return
    // Requires bwrap installed on the test machine.
    const home = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-lin-"))
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-runtime-"))
    try {
      await mkdir(path.join(home, ".ssh"), { recursive: true })
      await writeFile(path.join(home, ".ssh", "id_rsa"), "SECRET", "utf8")
      const policy = { ...POLICY_DEFAULT, readPathDeny: [`${home}/.ssh`] }
      const result = await runSandboxPreflight({
        platform: "linux",
        enabled: true,
        policy,
        homeDir: home,
        runtimeDir,
        sentinelPath: `${home}/.ssh/id_rsa`,
      })
      expect(result.ok).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(runtimeDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("returns ok on unsupported platform", async () => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-win-"))
    try {
      const result = await runSandboxPreflight({
        platform: "win32",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/tmp",
        runtimeDir,
        sentinelPath: "/tmp/x",
      })
      expect(result.ok).toBe(true)
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })
})
