import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { writeSpawnSettings } from "./settings-writer.adapter"

describe("writeSpawnSettings", () => {
  test("writes per-spawn settings with claimed keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    try {
      const result = await writeSpawnSettings({ runtimeDir: dir })
      expect(result.settingsPath.startsWith(dir)).toBe(true)
      const raw = await readFile(result.settingsPath, "utf8")
      const parsed = JSON.parse(raw)
      expect(parsed.spinnerTipsEnabled).toBe(false)
      expect(parsed.showTurnDuration).toBe(false)
      expect(parsed.permissions?.allow).toContain("mcp__kanna__*")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
