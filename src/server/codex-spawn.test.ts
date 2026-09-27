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

  test("passes Kanna's environment on", () => {
    const opts = buildCodexSpawnOptions("linux", "/project")
    expect(opts.env?.PATH).toBe(process.env.PATH)
    expect(opts.env?.HOME).toBe(process.env.HOME)
  })

  test("never passes on the NODE_ENV Kanna runs under", () => {
    const kannaNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
      expect(buildCodexSpawnOptions("linux", "/project").env).not.toHaveProperty("NODE_ENV")
      expect(buildCodexSpawnOptions("win32", "/project").env).not.toHaveProperty("NODE_ENV")
    } finally {
      process.env.NODE_ENV = kannaNodeEnv
    }
  })
})
