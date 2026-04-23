import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppSettingsManager, readAppSettingsSnapshot } from "./app-settings"

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function createTempFilePath() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
  tempDirs.push(dir)
  return path.join(dir, "settings.json")
}

describe("readAppSettingsSnapshot", () => {
  test("returns defaults when the file does not exist", async () => {
    const filePath = await createTempFilePath()
    const snapshot = await readAppSettingsSnapshot(filePath)

    expect(snapshot).toEqual({
      analyticsEnabled: true,
      warning: null,
      filePathDisplay: filePath,
    })
  })

  test("returns a warning when the file contains invalid json", async () => {
    const filePath = await createTempFilePath()
    await writeFile(filePath, "{not-json", "utf8")

    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.analyticsEnabled).toBe(true)
    expect(snapshot.warning).toContain("invalid JSON")
  })
})

describe("AppSettingsManager", () => {
  test("creates a settings file with analytics enabled and a stable anonymous id", async () => {
    const filePath = await createTempFilePath()
    const manager = new AppSettingsManager(filePath)

    await manager.initialize()

    const payload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsEnabled: boolean
      analyticsUserId: string
    }
    expect(payload.analyticsEnabled).toBe(true)
    expect(payload.analyticsUserId).toMatch(/^anon_/)
    expect(manager.getSnapshot()).toEqual({
      analyticsEnabled: true,
      warning: null,
      filePathDisplay: filePath,
    })

    manager.dispose()
  })

  test("writes analyticsEnabled without replacing the stored user id", async () => {
    const filePath = await createTempFilePath()
    const manager = new AppSettingsManager(filePath)

    await manager.initialize()
    const initialPayload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsEnabled: boolean
      analyticsUserId: string
    }

    const snapshot = await manager.write({ analyticsEnabled: false })
    const nextPayload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsEnabled: boolean
      analyticsUserId: string
    }

    expect(snapshot).toEqual({
      analyticsEnabled: false,
      warning: null,
      filePathDisplay: filePath,
    })
    expect(nextPayload.analyticsEnabled).toBe(false)
    expect(nextPayload.analyticsUserId).toBe(initialPayload.analyticsUserId)

    manager.dispose()
  })
})
