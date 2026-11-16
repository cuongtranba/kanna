import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import { createPluginService, type InstalledPluginStore, type PluginService } from "./plugin-service"

const HELLO = join(import.meta.dirname, "..", "__fixtures__", "plugins", "hello")

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function memoryStore(rows: InstalledPluginConfig[]): InstalledPluginStore {
  return {
    list: () => rows,
    upsert: async (entry) => {
      const index = rows.findIndex((row) => row.id === entry.id)
      if (index >= 0) rows[index] = entry
      else rows.push(entry)
    },
  }
}

async function installedHome(rows: InstalledPluginConfig[]) {
  const homeDir = await mkdtemp(join(tmpdir(), "kanna-plugin-boot-"))
  cleanups.push(() => rm(homeDir, { recursive: true, force: true }))
  const store = memoryStore(rows)
  const first = createPluginService({ homeDir, installed: store })
  await first.install({ sourceDir: HELLO })
  await first.setEnabled("hello", true)
  return { homeDir, store }
}

function rebooted(homeDir: string, store: InstalledPluginStore, log: (message: string) => void): PluginService {
  const service = createPluginService({ homeDir, installed: store, log })
  cleanups.push(async () => {
    for (const plugin of service.list()) await service.stop(plugin.id)
  })
  service.restore()
  return service
}

describe("PluginService.startEnabled", () => {
  test("after a restart an enabled plugin answers RPC without anyone reloading it", async () => {
    const { homeDir, store } = await installedHome([])
    const service = rebooted(homeDir, store, () => {})
    expect(service.status("hello")?.state).toBe("stopped")

    await service.startEnabled()

    expect(await service.call("hello", "greeting.create", { name: "Ada" })).toEqual({
      ok: true,
      output: { message: "Hello, Ada" },
    })
  }, 120_000)

  test("a plugin that cannot start is logged and does not keep the others from starting", async () => {
    const { homeDir, store } = await installedHome([{ id: "broken", sourceDir: "/nowhere/broken", enabled: true }])
    const logged: string[] = []
    const service = rebooted(homeDir, store, (message) => logged.push(message))

    await service.startEnabled()

    expect(service.status("hello")?.state).toBe("running")
    expect(service.status("broken")?.state).toBe("crashed")
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain("broken")
  }, 120_000)

  test("a disabled plugin stays stopped", async () => {
    const { homeDir, store } = await installedHome([])
    const service = rebooted(homeDir, store, () => {})
    await service.setEnabled("hello", false)

    await service.startEnabled()

    expect(service.status("hello")?.state).toBe("stopped")
  }, 120_000)
})
