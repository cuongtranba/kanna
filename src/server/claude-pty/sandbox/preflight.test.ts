import { describe, expect, test } from "bun:test"
import { runSandboxPreflight } from "./preflight"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { generateMacosProfile } from "./profile-macos"

describe("runSandboxPreflight", () => {
  test("returns ok when sentinel read is denied under the profile", async () => {
    if (process.platform !== "darwin") return
    // Set up a fake "home" with a sentinel under .ssh and a profile denying that dir.
    const home = await mkdtemp(path.join(tmpdir(), "kanna-sb-preflight-"))
    try {
      await mkdir(path.join(home, ".ssh"), { recursive: true })
      await writeFile(path.join(home, ".ssh", "id_rsa"), "SECRET", "utf8")
      const policy = {
        defaultAction: "ask" as const,
        bash: { autoAllowVerbs: [] },
        readPathDeny: [`${home}/.ssh`],
        writePathDeny: [],
        toolDenyList: [],
        toolAllowList: [],
      }
      const profile = generateMacosProfile({ policy, homeDir: home })
      const result = await runSandboxPreflight({
        platform: "darwin",
        enabled: true,
        profileBody: profile,
        sentinelPath: `${home}/.ssh/id_rsa`,
      })
      expect(result.ok).toBe(true)
    } finally { await rm(home, { recursive: true, force: true }) }
  }, 30_000)

  test("returns ok=false when sentinel read succeeds (sandbox not enforcing)", async () => {
    if (process.platform !== "darwin") return
    const home = await mkdtemp(path.join(tmpdir(), "kanna-sb-preflight-"))
    try {
      const sentinel = path.join(home, "readable.txt")
      await writeFile(sentinel, "OK", "utf8")
      // Profile with NO deny for this path → read should succeed → preflight fails.
      const profile = "(version 1)\n(allow default)\n"
      const result = await runSandboxPreflight({
        platform: "darwin",
        enabled: true,
        profileBody: profile,
        sentinelPath: sentinel,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain("sentinel readable")
    } finally { await rm(home, { recursive: true, force: true }) }
  }, 30_000)

  test("returns ok=true (skip) when sandbox not enabled", async () => {
    const result = await runSandboxPreflight({
      platform: "linux",
      enabled: true,
      profileBody: "",
      sentinelPath: "/tmp/x",
    })
    expect(result.ok).toBe(true)
  })
})
