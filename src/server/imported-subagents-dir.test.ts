import { describe, expect, test } from "bun:test"
import { deriveImportedSubagentsDir } from "./imported-subagents-dir"

describe("deriveImportedSubagentsDir", () => {
  test("joins encoded project dir + session uuid + subagents", () => {
    const dir = deriveImportedSubagentsDir({
      cwd: "/Users/home/repos/kanna",
      claudeSessionToken: "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f",
    })
    expect(dir.endsWith("/-Users-home-repos-kanna/4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f/subagents")).toBe(true)
  })

  test("respects an explicit homeDir override", () => {
    const dir = deriveImportedSubagentsDir({
      cwd: "/Users/home/repos/kanna",
      claudeSessionToken: "session-1",
      homeDir: "/tmp/fake-home",
    })
    expect(dir.startsWith("/tmp/fake-home/.claude/projects/")).toBe(true)
    expect(dir.endsWith("/session-1/subagents")).toBe(true)
  })
})
