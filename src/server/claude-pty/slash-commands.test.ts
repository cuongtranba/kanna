import { describe, expect, test } from "bun:test"
import { formatSlashCommand, writeSlashCommand } from "./slash-commands"

describe("formatSlashCommand", () => {
  test("plain command", () => {
    expect(formatSlashCommand("exit")).toBe("/exit\r")
  })
  test("command with arg", () => {
    expect(formatSlashCommand("model", "claude-sonnet-4-6")).toBe("/model claude-sonnet-4-6\r")
  })
  test("strips leading slash if caller passed one", () => {
    expect(formatSlashCommand("/exit")).toBe("/exit\r")
  })
})

describe("writeSlashCommand", () => {
  test("calls sendInput with formatted command", async () => {
    const calls: string[] = []
    await writeSlashCommand({
      sendInput: async (data: string) => { calls.push(data) },
    }, "model", "x")
    expect(calls).toEqual(["/model x\r"])
  })
})
