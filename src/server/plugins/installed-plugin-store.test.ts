/**
 * P11: an install must survive a restart, and a CLI install must become visible
 * to the server. Before this wire the service's registry was in-memory only —
 * the bundles were on disk but nothing remembered they existed.
 */
import { describe, expect, test } from "bun:test"
import { createInstalledPluginStore, type InstalledPluginSettings } from "./installed-plugin-store"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"

interface Written {
  create?: { sourceDir: string; id: string }
  update?: { id: string; patch: { enabled?: boolean } }
}

function fakeSettings(initial: InstalledPluginConfig[] = []) {
  const rows = [...initial]
  const writes: Written[] = []
  const settings: InstalledPluginSettings = {
    getSnapshot: () => ({ installedPlugins: rows }),
    writePatch: async (patch) => {
      writes.push(patch.installedPlugins)
      const { create, update } = patch.installedPlugins
      if (create) rows.push({ id: create.id, sourceDir: create.sourceDir, enabled: false })
      if (update) {
        const row = rows.find((r) => r.id === update.id)
        if (row && update.patch.enabled !== undefined) {
          rows.splice(rows.indexOf(row), 1, { ...row, enabled: update.patch.enabled })
        }
      }
      return undefined
    },
  }
  return { settings, rows, writes }
}

describe("createInstalledPluginStore", () => {
  test("list reflects what settings holds", () => {
    const { settings } = fakeSettings([{ id: "hello", sourceDir: "/src/hello", enabled: true }])
    expect(createInstalledPluginStore(settings).list()).toEqual([
      { id: "hello", sourceDir: "/src/hello", enabled: true },
    ])
  })

  test("list is empty, not undefined, when settings has no collection", () => {
    const store = createInstalledPluginStore({
      getSnapshot: () => ({}),
      writePatch: async () => undefined,
    })
    expect(store.list()).toEqual([])
  })

  test("a first install creates the record", async () => {
    const { settings, rows, writes } = fakeSettings()
    await createInstalledPluginStore(settings).upsert({ id: "hello", sourceDir: "/src/hello", enabled: false })

    expect(writes).toEqual([{ create: { id: "hello", sourceDir: "/src/hello" } }])
    expect(rows).toEqual([{ id: "hello", sourceDir: "/src/hello", enabled: false }])
  })

  // `create` carries no `enabled`, so an install that is somehow already
  // enabled needs the follow-up update or the flag would be silently dropped.
  test("a first install that is enabled also writes the flag", async () => {
    const { settings, writes } = fakeSettings()
    await createInstalledPluginStore(settings).upsert({ id: "hello", sourceDir: "/src/hello", enabled: true })

    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual({ update: { id: "hello", patch: { enabled: true } } })
  })

  test("re-installing an unchanged plugin writes nothing", async () => {
    const { settings, writes } = fakeSettings([{ id: "hello", sourceDir: "/src/hello", enabled: true }])
    await createInstalledPluginStore(settings).upsert({ id: "hello", sourceDir: "/src/hello", enabled: true })

    // Idempotent: `plugin reload` and repeated installs are routine, and each
    // settings write costs a disk round-trip plus a change notification.
    expect(writes).toEqual([])
  })

  test("flipping enabled updates rather than duplicating the record", async () => {
    const { settings, rows, writes } = fakeSettings([{ id: "hello", sourceDir: "/src/hello", enabled: false }])
    await createInstalledPluginStore(settings).upsert({ id: "hello", sourceDir: "/src/hello", enabled: true })

    expect(writes).toEqual([{ update: { id: "hello", patch: { enabled: true } } }])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.enabled).toBe(true)
  })
})
