import { describe, expect, test } from "bun:test"
import { buildCodexSpawnOptions } from "./codex-spawn.adapter"

describe("buildCodexSpawnOptions", () => {
  test("sets shell:true on Windows so .cmd executables are resolved", () => {
    const opts = buildCodexSpawnOptions("win32", "/project")
    expect(opts.shell).toBe(true)
  })

  test("does not set shell on macOS", () => {
    const opts = buildCodexSpawnOptions("darwin", "/project")
    expect(opts.shell).toBeFalsy()
  })

  test("does not set shell on Linux", () => {
    const opts = buildCodexSpawnOptions("linux", "/project")
    expect(opts.shell).toBeFalsy()
  })

  test("always sets cwd from argument", () => {
    const opts = buildCodexSpawnOptions("darwin", "/my/project")
    expect(opts.cwd).toBe("/my/project")
  })

  test("always pipes stdio", () => {
    const opts = buildCodexSpawnOptions("linux", "/project")
    expect(opts.stdio).toEqual(["pipe", "pipe", "pipe"])
  })

  test("always passes process.env", () => {
    const opts = buildCodexSpawnOptions("linux", "/project")
    expect(opts.env).toBe(process.env)
  })
})
