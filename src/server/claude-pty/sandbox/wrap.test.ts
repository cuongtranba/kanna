import { describe, expect, test } from "bun:test"
import { wrapWithSandbox } from "./wrap"

describe("wrapWithSandbox", () => {
  test("darwin + enabled → prepends sandbox-exec", () => {
    const result = wrapWithSandbox({
      platform: "darwin",
      enabled: true,
      profilePath: "/tmp/p.sb",
      command: "/usr/local/bin/claude",
      args: ["--model", "claude-sonnet-4-6"],
    })
    expect(result.command).toBe("/usr/bin/sandbox-exec")
    expect(result.args).toEqual([
      "-f", "/tmp/p.sb",
      "/usr/local/bin/claude",
      "--model", "claude-sonnet-4-6",
    ])
  })

  test("darwin + disabled → pass through", () => {
    const result = wrapWithSandbox({
      platform: "darwin",
      enabled: false,
      profilePath: "/tmp/p.sb",
      command: "/usr/local/bin/claude",
      args: ["--model", "x"],
    })
    expect(result.command).toBe("/usr/local/bin/claude")
    expect(result.args).toEqual(["--model", "x"])
  })

  test("non-darwin → pass through regardless of enabled flag", () => {
    const result = wrapWithSandbox({
      platform: "linux",
      enabled: true,
      profilePath: "/tmp/p.sb",
      command: "/usr/local/bin/claude",
      args: ["--model", "x"],
    })
    expect(result.command).toBe("/usr/local/bin/claude")
    expect(result.args).toEqual(["--model", "x"])
  })
})
