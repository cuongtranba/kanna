import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppSettingsManager } from "./app-settings"
import { MCP_SOURCE_AUTONOMY_DEFAULTS } from "../shared/inbox/autonomy"
import type { McpSourceInput, McpSourceReply } from "../shared/mcp-sources/types"

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

  test("a subscribe source stored before item splitting existed loads as a whole-payload source", async () => {
    const stored = { id: "s1", name: "Feed", mode: "subscribe", serverId: "x", enabled: true, threadKeyPath: "", senderPath: "", handler: { mode: "notify", chatId: "c1", template: "hi", replyHint: "", pushEnabled: true }, resourceUris: ["feed://a"], createdAt: 1, updatedAt: 1 }
    const manager = await startManager({ mcpSources: [stored] })
    expect(manager.getSnapshot().mcpSources[0]).toMatchObject({ id: "s1", mode: "subscribe", itemsPath: "", itemKeyPath: null, resyncIntervalMs: null })
  })

  test("a stored source without a text path loads with an empty one", async () => {
    const stored = { id: "s1", name: "Feed", mode: "subscribe", serverId: "x", enabled: true, threadKeyPath: "", senderPath: "", handler: { mode: "notify", chatId: "c1", template: "hi", replyHint: "", pushEnabled: true }, resourceUris: ["feed://a"], createdAt: 1, updatedAt: 1 }
    const manager = await startManager({ mcpSources: [stored] })
    expect(manager.getSnapshot().mcpSources[0]).toMatchObject({ textPath: "" })
  })

  test("a subscribe source created without the item fields gets the whole-payload defaults", async () => {
    const { manager, serverId } = await withServer()
    await manager.writePatch({ mcpSources: { create: { mode: "subscribe", name: "Feed", serverId, threadKeyPath: "", senderPath: "", handler: { mode: "spawn", projectId: "p1", template: "New message", replyHint: "", pushEnabled: true }, resourceUris: ["feed://a"] } } })
    expect(manager.getSnapshot().mcpSources[0]).toMatchObject({ mode: "subscribe", itemsPath: "", itemKeyPath: null, resyncIntervalMs: null })
  })

  test("a resync interval is clamped to the interval bounds", async () => {
    const stored = { id: "s1", name: "Feed", mode: "subscribe", serverId: "x", enabled: true, threadKeyPath: "", senderPath: "", handler: { mode: "notify", chatId: "c1", template: "hi", replyHint: "", pushEnabled: true }, resourceUris: ["feed://a"], itemsPath: "messages", itemKeyPath: "id", resyncIntervalMs: 10, createdAt: 1, updatedAt: 1 }
    const manager = await startManager({ mcpSources: [stored] })
    expect(manager.getSnapshot().mcpSources[0]).toMatchObject({ itemsPath: "messages", itemKeyPath: "id", resyncIntervalMs: 5000 })
  })
  const REPLY: McpSourceReply = {
    tool: "zalo_send_message",
    args: { threadId: "{{message.threadId}}", threadType: { from: "message.threadType", map: { dm: 0, group: 1 } }, text: "{{reply.text}}" },
    resultIdPath: "msgId",
  }

  const storedFeed = { id: "s1", name: "Feed", mode: "subscribe", serverId: "x", enabled: true, threadKeyPath: "", senderPath: "", handler: { mode: "notify", chatId: "c1", template: "hi", replyHint: "", pushEnabled: true }, resourceUris: ["feed://a"], createdAt: 1, updatedAt: 1 }

  test("a reply target round-trips through create, reload, patch and clear", async () => {
    const { manager, serverId } = await withServer()
    await manager.writePatch({ mcpSources: { create: { ...pollInput(serverId), reply: REPLY } } })
    expect(manager.getSnapshot().mcpSources[0]!.reply).toEqual(REPLY)

    const reloaded = new AppSettingsManager(manager.filePath)
    managers.push(reloaded)
    await reloaded.initialize()
    expect(reloaded.getSnapshot().mcpSources[0]!.reply).toEqual(REPLY)

    const id = manager.getSnapshot().mcpSources[0]!.id
    await manager.writePatch({ mcpSources: { update: { id, patch: { name: "Renamed" } } } })
    expect(manager.getSnapshot().mcpSources[0]!.reply).toEqual(REPLY)
    await manager.writePatch({ mcpSources: { update: { id, patch: { reply: null } } } })
    expect(manager.getSnapshot().mcpSources[0]!.reply).toBeNull()
  })

  test("a reply target with an empty tool name is refused", async () => {
    const { manager, serverId } = await withServer()
    await expect(manager.writePatch({ mcpSources: { create: { ...pollInput(serverId), reply: { ...REPLY, tool: " " } } } }))
      .rejects.toThrow("Reply tool is required")
  })

  test("a stored source without a reply target loads with reply null", async () => {
    const manager = await startManager({ mcpSources: [storedFeed] })
    expect(manager.getSnapshot().mcpSources[0]).toMatchObject({ id: "s1", reply: null })
  })

  test("a malformed stored reply loads as null and the source is kept", async () => {
    const manager = await startManager({ mcpSources: [{ ...storedFeed, reply: { tool: 3, args: "nope" } }, { ...storedFeed, id: "s2", reply: { tool: "t", args: { a: { from: "x", map: {} } }, resultIdPath: "" } }] })
    const sources = manager.getSnapshot().mcpSources
    expect(sources.map((source) => [source.id, source.reply])).toEqual([["s1", null], ["s2", null]])
  })

  test("a stored source without autonomy loads with the defaults", async () => {
    const manager = await startManager({ mcpSources: [storedFeed] })
    expect(manager.getSnapshot().mcpSources[0]!.autonomy).toEqual(MCP_SOURCE_AUTONOMY_DEFAULTS)
  })

  test("autonomy is clamped, cleaned, patched without losing other keys and survives a reload", async () => {
    const { manager, serverId } = await withServer()
    await manager.writePatch({
      mcpSources: {
        create: {
          ...pollInput(serverId),
          reply: REPLY,
          autonomy: { level: "auto", sendDelaySeconds: 1, threshold: 4, allowlist: [" t-9 ", "", "t-9"], quietHours: { start: "22:00", end: "07:00" } },
        },
      },
    })
    const id = manager.getSnapshot().mcpSources[0]!.id
    expect(manager.getSnapshot().mcpSources[0]!.autonomy).toMatchObject({
      level: "auto",
      sendDelaySeconds: 10,
      threshold: 1,
      allowlist: ["t-9"],
      quietHours: { start: "22:00", end: "07:00" },
      perThreadPerHour: MCP_SOURCE_AUTONOMY_DEFAULTS.perThreadPerHour,
    })

    await manager.writePatch({ mcpSources: { update: { id, patch: { autonomy: { allowlist: ["t-9", "t-10"] } } } } })
    const reloaded = new AppSettingsManager(manager.filePath)
    managers.push(reloaded)
    await reloaded.initialize()
    expect(reloaded.getSnapshot().mcpSources[0]!.autonomy).toMatchObject({ level: "auto", allowlist: ["t-9", "t-10"], sendDelaySeconds: 10 })
  })

  test("a level above suggest without a reply target is refused", async () => {
    const { manager, serverId } = await withServer()
    await expect(manager.writePatch({ mcpSources: { create: { ...pollInput(serverId), autonomy: { level: "approve" } } } }))
      .rejects.toThrow("Approve and Auto autonomy need a reply target")
    await manager.writePatch({ mcpSources: { create: { ...pollInput(serverId), reply: REPLY, autonomy: { level: "approve" } } } })
    const id = manager.getSnapshot().mcpSources[0]!.id
    await expect(manager.writePatch({ mcpSources: { update: { id, patch: { reply: null } } } }))
      .rejects.toThrow("need a reply target")
  })

  test("malformed quiet hours are refused", async () => {
    const { manager, serverId } = await withServer()
    await expect(manager.writePatch({ mcpSources: { create: { ...pollInput(serverId), autonomy: { quietHours: { start: "25:00", end: "07:00" } } } } }))
      .rejects.toThrow("Quiet hours must be HH:MM times")
  })
})
