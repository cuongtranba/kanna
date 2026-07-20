import { describe, expect, test } from "bun:test"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import type { StorageBackend } from "./storage/backend"
import {
  appendPushEvent,
  appendShareEvent,
  appendTunnelEvent,
  getShareEvents,
  getTunnelEvents,
  listTunnelChats,
  loadPushEvents,
  loadShareEvents,
  loadTunnelEvents,
  type PeripheralEventsDeps,
} from "./event-store-peripheral-events.adapter"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal in-memory StorageBackend stub. */
function makeStorage(files: Map<string, string> = new Map()): StorageBackend {
  return {
    mkdir: async () => {},
    exists: async (p) => files.has(p),
    existsSync: (p) => files.has(p),
    size: async (p) => files.get(p)?.length ?? 0,
    readText: async (p) => files.get(p) ?? "",
    readTextSync: (p) => files.get(p) ?? "",
    writeText: async (p, v) => { files.set(p, v) },
    appendText: async (p, v) => { files.set(p, (files.get(p) ?? "") + v) },
    rename: async () => {},
    remove: async () => {},
  }
}

function makeWriteChainRef() {
  let chain = Promise.resolve()
  return {
    getWriteChain: () => chain,
    setWriteChain: (p: Promise<void>) => { chain = p },
  }
}

function makeDeps(overrides: Partial<PeripheralEventsDeps> = {}): PeripheralEventsDeps {
  const wc = makeWriteChainRef()
  return {
    storage: makeStorage(),
    tunnelLogPath: "/data/tunnels.jsonl",
    sharesLogPath: "/data/shares.jsonl",
    pushLogPath: "/data/push.jsonl",
    tunnelEventsByChatId: new Map(),
    shareEventsAll: [],
    getWriteChain: wc.getWriteChain,
    setWriteChain: wc.setWriteChain,
    ...overrides,
  }
}

function makeTunnelEvent(chatId = "chat-1"): CloudflareTunnelEvent {
  return { type: "tunnel_started", chatId, tunnelId: "t-1", url: "https://ex.trycloudflare.com", timestamp: 1000 } as unknown as CloudflareTunnelEvent
}

function makeShareEvent(chatId = "chat-1"): ShareEvent {
  return { type: "share_minted", chatId, shareId: "s-1", token: "tok", expiresAt: null, timestamp: 1000 } as unknown as ShareEvent
}

function makePushEvent(): PushEvent {
  return { type: "push_device_registered", deviceId: "d-1", pushToken: "pt-1", platform: "web", timestamp: 1000 } as unknown as PushEvent
}

// ---------------------------------------------------------------------------
// Tunnel tests
// ---------------------------------------------------------------------------

describe("getTunnelEvents", () => {
  test("returns empty array for unknown chatId", () => {
    const deps = makeDeps()
    expect(getTunnelEvents(deps, "no-chat")).toEqual([])
  })

  test("returns list for known chatId", () => {
    const ev = makeTunnelEvent("chat-a")
    const tunnelEventsByChatId = new Map([["chat-a", [ev]]])
    const deps = makeDeps({ tunnelEventsByChatId })
    expect(getTunnelEvents(deps, "chat-a")).toEqual([ev])
  })

  test("returns a copy (not the original array)", () => {
    const ev = makeTunnelEvent("chat-a")
    const inner: CloudflareTunnelEvent[] = [ev]
    const tunnelEventsByChatId = new Map([["chat-a", inner]])
    const deps = makeDeps({ tunnelEventsByChatId })
    const result = getTunnelEvents(deps, "chat-a")
    expect(result).toEqual([ev])
    expect(result).not.toBe(inner)
  })
})

describe("listTunnelChats", () => {
  test("returns empty array when no chats", () => {
    const deps = makeDeps()
    expect(listTunnelChats(deps)).toEqual([])
  })

  test("returns all chatIds with tunnel events", () => {
    const tunnelEventsByChatId = new Map([
      ["c1", [makeTunnelEvent("c1")]],
      ["c2", [makeTunnelEvent("c2")]],
    ])
    const deps = makeDeps({ tunnelEventsByChatId })
    expect(listTunnelChats(deps)).toEqual(expect.arrayContaining(["c1", "c2"]))
  })
})

describe("appendTunnelEvent", () => {
  test("writes to tunnelLogPath and updates in-memory map", async () => {
    const files = new Map([[ "/data/tunnels.jsonl", "" ]])
    const storage = makeStorage(files)
    const deps = makeDeps({ storage })
    const ev = makeTunnelEvent("chat-1")

    await appendTunnelEvent(deps, ev)

    // Disk
    const content = files.get("/data/tunnels.jsonl") ?? ""
    expect(content.trim()).toBe(JSON.stringify(ev))

    // In-memory map
    expect(getTunnelEvents(deps, "chat-1")).toEqual([ev])
  })

  test("chains multiple appends in order", async () => {
    const files = new Map([["/data/tunnels.jsonl", ""]])
    const storage = makeStorage(files)
    const deps = makeDeps({ storage })
    const ev1 = { ...makeTunnelEvent("chat-1"), tunnelId: "t-1" }
    const ev2 = { ...makeTunnelEvent("chat-1"), tunnelId: "t-2" }

    await Promise.all([appendTunnelEvent(deps, ev1), appendTunnelEvent(deps, ev2)])

    const lines = (files.get("/data/tunnels.jsonl") ?? "").trim().split("\n")
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).tunnelId).toBe("t-1")
    expect(JSON.parse(lines[1]!).tunnelId).toBe("t-2")
  })
})

describe("loadTunnelEvents", () => {
  test("populates in-memory map from disk", async () => {
    const ev = makeTunnelEvent("chat-x")
    const files = new Map([["/data/tunnels.jsonl", `${JSON.stringify(ev)}\n`]])
    const storage = makeStorage(files)
    const tunnelEventsByChatId = new Map<string, CloudflareTunnelEvent[]>()
    const deps = makeDeps({ storage, tunnelEventsByChatId })

    await loadTunnelEvents(deps)

    expect(getTunnelEvents(deps, "chat-x")).toEqual([ev])
  })

  test("handles empty log file without errors", async () => {
    const files = new Map([["/data/tunnels.jsonl", ""]])
    const deps = makeDeps({ storage: makeStorage(files) })
    await expect(loadTunnelEvents(deps)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Share tests
// ---------------------------------------------------------------------------

describe("getShareEvents", () => {
  test("returns empty array by default", () => {
    const deps = makeDeps()
    expect(getShareEvents(deps)).toEqual([])
  })

  test("returns a copy of shareEventsAll", () => {
    const ev = makeShareEvent()
    const shareEventsAll: ShareEvent[] = [ev]
    const deps = makeDeps({ shareEventsAll })
    const result = getShareEvents(deps)
    expect(result).toEqual([ev])
    expect(result).not.toBe(shareEventsAll)
  })
})

describe("appendShareEvent", () => {
  test("writes to sharesLogPath and pushes into shareEventsAll", async () => {
    const files = new Map([["/data/shares.jsonl", ""]])
    const storage = makeStorage(files)
    const shareEventsAll: ShareEvent[] = []
    const deps = makeDeps({ storage, shareEventsAll })
    const ev = makeShareEvent("chat-2")

    await appendShareEvent(deps, ev)

    expect(files.get("/data/shares.jsonl")?.trim()).toBe(JSON.stringify(ev))
    expect(shareEventsAll).toEqual([ev])
  })
})

describe("loadShareEvents", () => {
  test("fills shareEventsAll from disk", async () => {
    const ev = makeShareEvent("chat-y")
    const files = new Map([["/data/shares.jsonl", `${JSON.stringify(ev)}\n`]])
    const storage = makeStorage(files)
    const shareEventsAll: ShareEvent[] = []
    const deps = makeDeps({ storage, shareEventsAll })

    await loadShareEvents(deps)

    expect(shareEventsAll).toEqual([ev])
  })
})

// ---------------------------------------------------------------------------
// Push tests
// ---------------------------------------------------------------------------

describe("appendPushEvent", () => {
  test("writes to pushLogPath (no in-memory state)", async () => {
    const files = new Map([["/data/push.jsonl", ""]])
    const storage = makeStorage(files)
    const deps = makeDeps({ storage })
    const ev = makePushEvent()

    await appendPushEvent(deps, ev)

    expect(files.get("/data/push.jsonl")?.trim()).toBe(JSON.stringify(ev))
  })
})

describe("loadPushEvents", () => {
  test("returns events from push log", async () => {
    const ev = makePushEvent()
    const files = new Map([["/data/push.jsonl", `${JSON.stringify(ev)}\n`]])
    const deps = makeDeps({ storage: makeStorage(files) })

    const result = await loadPushEvents(deps)

    expect(result).toEqual([ev])
  })

  test("returns empty array for empty log", async () => {
    const files = new Map([["/data/push.jsonl", ""]])
    const deps = makeDeps({ storage: makeStorage(files) })
    const result = await loadPushEvents(deps)
    expect(result).toEqual([])
  })
})
