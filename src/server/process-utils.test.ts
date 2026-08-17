import { describe, expect, test } from "bun:test"
import { hasCommand, spawnDetached } from "./process-utils.adapter"

describe("spawnDetached", () => {
  test("rejects when the command does not exist", async () => {
    await expect(spawnDetached("definitely-not-a-real-command-kanna", [])).rejects.toThrow("Command not found")
  })

  test("resolves when the process starts successfully", async () => {
    await expect(spawnDetached("sh", ["-c", "exit 0"])).resolves.toBeUndefined()
  })
})

describe("hasCommand", () => {
  test("returns false for a non-existent command", () => {
    expect(hasCommand("definitely-not-a-real-command-kanna")).toBe(false)
  })

  test("returns true for a command that exists on the current platform", () => {
    const knownCommand = process.platform === "win32" ? "where" : "ls"
    expect(hasCommand(knownCommand)).toBe(true)
  })
})
