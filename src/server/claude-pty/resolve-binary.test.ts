import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveClaudeBinary } from "./resolve-binary.adapter"

describe("resolveClaudeBinary", () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "kanna-resolve-binary-"))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function makeExec(p: string): Promise<void> {
    await mkdir(path.dirname(p), { recursive: true })
    await writeFile(p, "#!/bin/sh\necho fake\n", { encoding: "utf8" })
    await chmod(p, 0o755)
  }

  test("returns CLAUDE_EXECUTABLE when set and exists", async () => {
    const bin = path.join(workDir, "fake-claude")
    await makeExec(bin)
    const result = await resolveClaudeBinary({
      env: { CLAUDE_EXECUTABLE: bin, PATH: "" },
      homeDir: workDir,
      cwd: workDir,
      platform: "darwin",
      arch: "arm64",
    })
    expect(result.source).toBe("env-CLAUDE_EXECUTABLE")
    expect(result.path).toBe(bin)
  })

  test("expands tilde in CLAUDE_EXECUTABLE", async () => {
    const bin = path.join(workDir, "tilde-claude")
    await makeExec(bin)
    const result = await resolveClaudeBinary({
      env: { CLAUDE_EXECUTABLE: "~/tilde-claude", PATH: "" },
      homeDir: workDir,
      cwd: workDir,
      platform: "darwin",
      arch: "arm64",
    })
    expect(result.path).toBe(bin)
  })

  test("falls back to CLAUDE_CODE_EXECPATH when CLAUDE_EXECUTABLE missing file", async () => {
    const bin = path.join(workDir, "execpath-claude")
    await makeExec(bin)
    const result = await resolveClaudeBinary({
      env: {
        CLAUDE_EXECUTABLE: path.join(workDir, "does-not-exist"),
        CLAUDE_CODE_EXECPATH: bin,
        PATH: "",
      },
      homeDir: workDir,
      cwd: workDir,
      platform: "darwin",
      arch: "arm64",
    })
    expect(result.source).toBe("env-CLAUDE_CODE_EXECPATH")
    expect(result.path).toBe(bin)
  })

  test("falls back to node_modules platform-bundled binary", async () => {
    const inner = path.join(workDir, "nested", "deep")
    await mkdir(inner, { recursive: true })
    const bundled = path.join(workDir, "node_modules", "@anthropic-ai", "claude-agent-sdk-darwin-arm64", "claude")
    await makeExec(bundled)
    const result = await resolveClaudeBinary({
      env: { PATH: "" },
      homeDir: workDir,
      cwd: inner,
      platform: "darwin",
      arch: "arm64",
    })
    expect(result.source).toBe("node_modules")
    expect(result.path).toBe(bundled)
  })

  test("walks parent dirs when looking up node_modules bundled binary", async () => {
    const inner = path.join(workDir, "a", "b", "c")
    await mkdir(inner, { recursive: true })
    const bundled = path.join(workDir, "node_modules", "@anthropic-ai", "claude-agent-sdk-linux-x64", "claude")
    await makeExec(bundled)
    const result = await resolveClaudeBinary({
      env: { PATH: "" },
      homeDir: workDir,
      cwd: inner,
      platform: "linux",
      arch: "x64",
    })
    expect(result.path).toBe(bundled)
  })

  test("throws with all tried paths when nothing resolves", async () => {
    let err: unknown
    try {
      await resolveClaudeBinary({
        env: { CLAUDE_EXECUTABLE: path.join(workDir, "missing"), PATH: "" },
        homeDir: workDir,
        cwd: workDir,
        platform: "darwin",
        arch: "arm64",
      })
    } catch (caught) {
      err = caught
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("Unable to locate")
    expect((err as Error).message).toContain("CLAUDE_EXECUTABLE")
    expect((err as Error).message).toContain("node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude")
  }, 10_000)
})
