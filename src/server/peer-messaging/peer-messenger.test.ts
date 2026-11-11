import { describe, expect, test } from "vite-plus/test"
import type { PeerChatOrigin } from "../../shared/command-origin"
import type { KannaStatus } from "../../shared/core-types"
import type { PeerInboundMode } from "../../shared/peer-messaging/inbound"
import type { QueuedChatMessage } from "../../shared/types"
import { PeerMessenger, type PeerChatInfo } from "./peer-messenger"

interface StartedTurn {
  chatId: string
  content: string
  origin: PeerChatOrigin | undefined
}

function createWorld(chats: PeerChatInfo[]) {
  const chatsById = new Map(chats.map((chat) => [chat.chatId, chat]))
  const busy = new Set<string>()
  const queues = new Map<string, QueuedChatMessage[]>()
  const started: StartedTurn[] = []
  const world = {
    clock: 1_000_000,
    globalInbound: "accept" as PeerInboundMode,
    idCounter: 0,
    started,
    busy,
  }
  const queueOf = (chatId: string) => {
    const queue = queues.get(chatId) ?? []
    queues.set(chatId, queue)
    return queue
  }
  const startNextQueued = async (chatId: string) => {
    const next = queueOf(chatId)[0]
    if (busy.has(chatId) || !next) return
    queueOf(chatId).shift()
    busy.add(chatId)
    started.push({ chatId, content: next.content, origin: next.origin?.kind === "peer_chat" ? next.origin : undefined })
  }
  const messenger = new PeerMessenger({
    listChats: () => [...chatsById.values()],
    getChat: (chatId) => chatsById.get(chatId) ?? null,
    activeStatuses: () => new Map<string, KannaStatus>([...busy].map((chatId) => [chatId, "running"])),
    queuedMessages: queueOf,
    globalInbound: () => world.globalInbound,
    enqueue: async (chatId, content, origin) => {
      queueOf(chatId).push({ id: `q-${String(queueOf(chatId).length)}`, content, attachments: [], createdAt: world.clock, origin })
    },
    startNextQueued,
    now: () => world.clock,
    newId: () => `msg-${String(++world.idCounter)}`,
  })
  const endTurn = async (chatId: string) => {
    busy.delete(chatId)
    await startNextQueued(chatId)
    await messenger.onChatSettled(chatId)
  }
  return { world, messenger, endTurn }
}

function chat(chatId: string, overrides: Partial<PeerChatInfo> = {}): PeerChatInfo {
  return { chatId, title: `Chat ${chatId}`, projectId: `project-${chatId}`, projectTitle: `Project ${chatId}`, provider: "claude", peerInbound: null, archived: false, ...overrides }
}

describe("PeerMessenger", () => {
  test("a message to an idle chat starts a turn there, stamped with the sender", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "run the migration" })
    expect(result).toEqual({ ok: true, status: "delivered", messageId: "msg-1", subscribed: false })
    expect(world.started).toEqual([{
      chatId: "b",
      content: "run the migration",
      origin: { kind: "peer_chat", fromChatId: "a", fromTitle: "Chat a", fromProjectId: "project-a", fromProjectTitle: "Project a", messageId: "msg-1" },
    }])
  })

  test("a message to a busy chat waits and runs after its turn ends", async () => {
    const { messenger, world, endTurn } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "when you can" })
    expect(result).toMatchObject({ ok: true, status: "queued" })
    expect(world.started).toEqual([])
    await endTurn("b")
    expect(world.started.map((turn) => turn.content)).toEqual(["when you can"])
  })

  test("refuses a chat that does not exist, itself, an archived chat, and a chat that opted out", async () => {
    const { messenger } = createWorld([chat("a"), chat("archived", { archived: true }), chat("closed", { peerInbound: "refuse" })])
    const reasons = []
    for (const to of ["gone", "a", "archived", "closed"]) {
      const result = await messenger.send({ fromChatId: "a", to, message: "hi" })
      reasons.push(result.ok ? "sent" : result.reason)
    }
    expect(reasons).toEqual(["unknown_chat", "self", "archived", "inbound_refused"])
  })

  test("the global setting refuses every chat, and a per-chat accept overrides it", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b"), chat("open", { peerInbound: "accept" })])
    world.globalInbound = "refuse"
    const refused = await messenger.send({ fromChatId: "a", to: "b", message: "hi" })
    const allowed = await messenger.send({ fromChatId: "a", to: "open", message: "hi" })
    expect(refused).toMatchObject({ ok: false, reason: "inbound_refused" })
    expect(allowed).toMatchObject({ ok: true })
    expect(messenger.listPeers("a").map((row) => [row.chatId, row.accepts])).toEqual([["b", false], ["open", true]])
  })

  test("an identical message to the same chat within a minute is dropped, but sent again later", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    await messenger.send({ fromChatId: "a", to: "b", message: "same" })
    const repeat = await messenger.send({ fromChatId: "a", to: "b", message: "same" })
    expect(repeat).toMatchObject({ ok: false, reason: "duplicate" })
    world.clock += 61_000
    const later = await messenger.send({ fromChatId: "a", to: "b", message: "same" })
    expect(later).toMatchObject({ ok: true })
  })

  test("a flood from one chat to another is rate limited, and recovers", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    const outcomes = []
    for (let index = 0; index < 8; index += 1) {
      const result = await messenger.send({ fromChatId: "a", to: "b", message: `message ${String(index)}` })
      outcomes.push(result.ok ? "ok" : result.reason)
    }
    expect(outcomes).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "rate_limited", "rate_limited"])
    world.clock += 60_000
    expect(await messenger.send({ fromChatId: "a", to: "b", message: "after the pause" })).toMatchObject({ ok: true })
  })

  test("notify_when_idle tells the sender once when the target goes idle", async () => {
    const { messenger, world, endTurn } = createWorld([chat("a"), chat("b")])
    await messenger.send({ fromChatId: "a", to: "b", message: "do the thing", notifyWhenIdle: true })
    await endTurn("b")
    await endTurn("b")
    const notices = world.started.filter((turn) => turn.chatId === "a")
    expect(notices).toHaveLength(1)
    expect(notices[0]?.content).toContain("Chat b")
    expect(notices[0]?.origin?.fromChatId).toBe("b")
  })

  test("notify_when_idle on a chat that is already idle notifies at once", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    const result = await messenger.send({ fromChatId: "a", to: "b", notifyWhenIdle: true })
    expect(result).toMatchObject({ ok: true, status: "subscribed", subscribed: false })
    expect(world.started.map((turn) => turn.chatId)).toEqual(["a"])
  })

  test("notify_when_idle expires after twelve hours", async () => {
    const { messenger, world, endTurn } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    await messenger.send({ fromChatId: "a", to: "b", notifyWhenIdle: true })
    world.clock += 12 * 60 * 60 * 1000 + 1
    await endTurn("b")
    expect(world.started).toEqual([])
  })
})
