import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { wrapWithSandbox } from "./wrap"
import { POLICY_DEFAULT } from "../../../shared/permission-policy"

describe("wrapWithSandbox (async dispatch)", () => {
  test("darwin enabled → prepends sandbox-exec and writes profile", async () => {
    if (process.platform !== "darwin") return
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "darwin",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/Users/u",
        runtimeDir,
        command: "/usr/local/bin/claude",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("/usr/bin/sandbox-exec")
      expect(result.args[0]).toBe("-f")
      const profile = await readFile(result.args[1], "utf8")
      expect(profile).toContain("(version 1)")
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })

  test("linux enabled → prepends bwrap argv", async () => {
    if (process.platform !== "linux") return
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "linux",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/home/u",
        runtimeDir,
        command: "/usr/local/bin/claude",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("/usr/bin/bwrap")
      expect(result.args).toContain("--bind")
      expect(result.args).toContain("--die-with-parent")
      expect(result.args).toContain("/usr/local/bin/claude")
      expect(result.args).toContain("--model")
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })

  test("disabled → pass through", async () => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "darwin",
        enabled: false,
        policy: POLICY_DEFAULT,
        homeDir: "/Users/u",
        runtimeDir,
        command: "/usr/local/bin/claude",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("/usr/local/bin/claude")
      expect(result.args).toEqual(["--model", "x"])
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })

  test("unsupported platform → pass through", async () => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "win32",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/Users/u",
        runtimeDir,
        command: "claude.exe",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("claude.exe")
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })
})
