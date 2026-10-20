import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppSettingsManager } from "./app-settings"
import type { McpSourceInput } from "../shared/mcp-sources/types"

let dirs: string[] = []
let managers: AppSettingsManager[] = []

afterEach(async () => {
  for (const manager of managers) manager.dispose()
  managers = []
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

async function startManager(initial?: Record<string, unknown>): Promise<AppSettingsManager> {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-sources-"))
  dirs.push(dir)
  const filePath = path.join(dir, "settings.json")
  if (initial) await writeFile(filePath, JSON.stringify(initial), "utf8")
  const manager = new AppSettingsManager(filePath)
  managers.push(manager)
  await manager.initialize()
  return manager
}

async function withServer(): Promise<{ manager: AppSettingsManager; serverId: string }> {
  const manager = await startManager()
  await manager.writePatch({ customMcpServers: { create: { name: "zalo", transport: "http", url: "http://127.0.0.1:3847/mcp", headers: {} } } })
  return { manager, serverId: manager.getSnapshot().customMcpServers[0]!.id }
}

function pollInput(serverId: string): Extract<McpSourceInput, { mode: "poll" }> {
  return {
    mode: "poll",
    name: "Zalo",
    serverId,
    threadKeyPath: "threadId",
    senderPath: "senderName",
    handler: { mode: "spawn", projectId: "p1", template: "New message", replyHint: "", pushEnabled: true },
    tool: "zalo_get_messages",
    args: { limit: 50 },
    cursorArg: "since",
    cursorPath: "cursor",
    itemsPath: "messages",
    itemKeyPath: "messageId",
    intervalMs: 1000,
  }
}

describe("mcpSources settings", () => {
  test("a created source persists across reload with a clamped interval", async () => {
    const { manager, serverId } = await withServer()
    await manager.writePatch({ mcpSources: { create: pollInput(serverId) } })
    const [created] = manager.getSnapshot().mcpSources
    expect(created).toMatchObject({ mode: "poll", name: "Zalo", enabled: true, intervalMs: 5000 })

    const reloaded = new AppSettingsManager(manager.filePath)
    managers.push(reloaded)
    await reloaded.initialize()
    expect(reloaded.getSnapshot().mcpSources).toEqual(manager.getSnapshot().mcpSources)
  })

  test("a source naming a server that does not exist is refused", async () => {
    const manager = await startManager()
    await expect(manager.writePatch({ mcpSources: { create: pollInput("ghost") } })).rejects.toThrow("does not exist")
    expect(manager.getSnapshot().mcpSources).toEqual([])
  })

  test("an invalid source is refused with every problem named", async () => {
    const { manager, serverId } = await withServer()
    await expect(manager.writePatch({ mcpSources: { create: { ...pollInput(serverId), tool: "", name: "" } } }))
      .rejects.toThrow("Name is required; Tool is required")
  })

  test("update switches mode, setEnabled toggles and delete removes", async () => {
    const { manager, serverId } = await withServer()
    await manager.writePatch({ mcpSources: { create: pollInput(serverId) } })
    const id = manager.getSnapshot().mcpSources[0]!.id

    await manager.writePatch({ mcpSources: { update: { id, patch: { mode: "subscribe", resourceUris: ["feed://inbox"] } } } })
    expect(manager.getSnapshot().mcpSources[0]).toMatchObject({ mode: "subscribe", resourceUris: ["feed://inbox"] })

    await manager.writePatch({ mcpSources: { setEnabled: { id, enabled: false } } })
    expect(manager.getSnapshot().mcpSources[0]!.enabled).toBe(false)

    await manager.writePatch({ mcpSources: { delete: { id } } })
    expect(manager.getSnapshot().mcpSources).toEqual([])
  })

  test("deleting the server leaves its sources in place for the runner to report", async () => {
    const { manager, serverId } = await withServer()
    await manager.writePatch({ mcpSources: { create: pollInput(serverId) } })
    await manager.writePatch({ customMcpServers: { delete: { id: serverId } } })
    expect(manager.getSnapshot().mcpSources).toHaveLength(1)
  })

  test("an invalid entry in the file is dropped with a warning and the valid one is kept", async () => {
    const valid = { id: "s1", name: "Feed", mode: "subscribe", serverId: "x", enabled: true, threadKeyPath: "", senderPath: "", handler: { mode: "notify", chatId: "c1", template: "hi", replyHint: "", pushEnabled: true }, resourceUris: ["feed://a"], createdAt: 1, updatedAt: 1 }
    const manager = await startManager({ mcpSources: [valid, { id: "s2", name: "Bad", mode: "subscribe", serverId: "x", handler: { mode: "notify" }, resourceUris: [] }] })
    const snapshot = manager.getSnapshot()
    expect(snapshot.mcpSources.map((source) => source.id)).toEqual(["s1"])
    expect(snapshot.warning).toContain("mcpSources: dropped Bad")
  })
})
