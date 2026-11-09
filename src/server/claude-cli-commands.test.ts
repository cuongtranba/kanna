import { afterEach, describe, expect, test, vi } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openClaudeCliCommands } from "./claude-cli-commands"
import { createClaudeCliCommandFile } from "./claude-cli-commands-file.adapter"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createCatalogFilePath() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-cli-commands-"))
  tempDirs.push(dir)
  return path.join(dir, "claude-cli-commands.json")
}

const DOCTOR = { name: "doctor", description: "Diagnose", argumentHint: "", builtin: true }

describe("openClaudeCliCommands", () => {
  test("a restarted Kanna lists the commands recorded by the previous run", async () => {
    const filePath = await createCatalogFilePath()
    const first = await openClaudeCliCommands(createClaudeCliCommandFile(filePath))
    first.record([DOCTOR])

    await vi.waitFor(async () => {
      const restarted = await openClaudeCliCommands(createClaudeCliCommandFile(filePath))
      expect(restarted.list()).toEqual([
        { name: "doctor", description: "Diagnose", argumentHint: "", kind: "command", scope: "cli" },
      ])
    })
  })

  test("subscribers are told about a changed list but not about an identical re-record", async () => {
    let changes = 0
    const catalog = await openClaudeCliCommands(
      { load: async () => [], save: async () => {} },
      () => { changes += 1 },
    )
    catalog.record([DOCTOR])
    catalog.record([DOCTOR])
    expect(changes).toBe(1)
    catalog.record([DOCTOR, { name: "init", description: "Init", argumentHint: "", builtin: true }])
    expect(changes).toBe(2)
  })
})
