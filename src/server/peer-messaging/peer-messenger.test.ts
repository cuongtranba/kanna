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
  const timers = new Map<number, () => void>()
  const injected: string[] = []
  const world = {
    clock: 1_000_000,
    globalInbound: "accept" as PeerInboundMode,
    idCounter: 0,
    queueCounter: 0,
    acceptInjection: false,
    liveRuns: new Set<string>(),
    delivered: [] as { chatId: string; runId: string; content: string; origin: PeerChatOrigin }[],
    started,
    injected,
    busy,
    fireTimers: () => {
      for (const [id, run] of [...timers]) {
        timers.delete(id)
        run()
      }
    },
    pendingTimers: () => timers.size,
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
      const id = `q-${String(++world.queueCounter)}`
      queueOf(chatId).push({ id, content, attachments: [], createdAt: world.clock, origin })
      return id
    },
    startNextQueued,
    injectMidTurn: async (chatId, queuedMessageId) => {
      if (!world.acceptInjection) return false
      const queue = queueOf(chatId)
      const index = queue.findIndex((queued) => queued.id === queuedMessageId)
      if (index < 0) return false
      const [taken] = queue.splice(index, 1)
      injected.push(taken?.content ?? "")
      return true
    },
    deliverToRun: async (chatId, runId, content, origin) => {
      if (!world.liveRuns.has(runId)) return false
      world.delivered.push({ chatId, runId, content, origin })
      return true
    },
    after: (_delayMs, run) => {
      const id = ++world.queueCounter
      timers.set(id, run)
      return () => { timers.delete(id) }
    },
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

  test("a message to a busy chat is read in its running turn when the provider takes it", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    world.acceptInjection = true
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "when you can" })
    expect(result).toMatchObject({ ok: true, status: "injected" })
    expect(world.injected).toEqual(["when you can"])
    expect(world.started).toEqual([])
  })

  test("a message to a busy chat that cannot take it mid-turn waits and runs after its turn ends", async () => {
    const { messenger, world, endTurn } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "when you can" })
    expect(result).toMatchObject({ ok: true, status: "queued" })
    expect(world.started).toEqual([])
    await endTurn("b")
    expect(world.started.map((turn) => turn.content)).toEqual(["when you can"])
  })

  test("reply_to is stamped on the message so the receiver can tell which message was answered", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    await messenger.send({ fromChatId: "a", to: "b", message: "here is the answer", replyTo: "msg-from-b" })
    expect(world.started[0]?.origin).toMatchObject({ messageId: "msg-1", inReplyTo: "msg-from-b" })
  })

  test("a message addressed to a running subagent run goes to that run, not the chat's queue", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.liveRuns.add("run-1")
    const result = await messenger.send({
      fromChatId: "a",
      to: "b",
      message: "use the new schema",
      runId: "run-1",
      fromRunId: "run-9",
      fromSubagentName: "reviewer",
    })
    expect(result).toMatchObject({ ok: true, status: "injected" })
    expect(world.delivered).toHaveLength(1)
    expect(world.delivered[0]).toMatchObject({
      chatId: "b",
      runId: "run-1",
      content: "use the new schema",
      origin: { fromRunId: "run-9", fromSubagentName: "reviewer" },
    })
    expect(world.started).toEqual([])
  })

  test("a message addressed to a run that is no longer running falls back to the chat itself", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "are you there", runId: "run-gone" })
    expect(result).toMatchObject({ ok: true, status: "delivered" })
    expect(world.started.map((turn) => turn.content)).toEqual(["are you there"])
  })

  test("a message handed back from a subagent run that ended unread is delivered to the chat like a normal peer message", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    const origin: PeerChatOrigin = { kind: "peer_chat", fromChatId: "a", fromTitle: "Chat a", fromProjectId: "project-a", fromProjectTitle: "Project a", messageId: "msg-7", fromRunId: "run-9" }
    await messenger.deliverToChat("b", "use the new schema", origin)
    expect(world.started).toEqual([{ chatId: "b", content: "use the new schema", origin }])
  })

  test("a chat waiting for a message receives it directly without it being queued", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const waiting = messenger.waitForMessage({ chatId: "b", from: "a" })
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "the build is green" })
    expect(result).toMatchObject({ ok: true, status: "delivered" })
    const received = await waiting
    expect(received).toMatchObject({ status: "message", messageId: "msg-1", fromChatId: "a" })
    expect(received.status === "message" ? received.message : "").toContain("the build is green")
    expect(world.started).toEqual([])
    expect(world.pendingTimers()).toBe(0)
  })

  test("a wait that names a sender ignores messages from other chats", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b"), chat("c")])
    world.busy.add("b")
    const waiting = messenger.waitForMessage({ chatId: "b", from: "a" })
    const result = await messenger.send({ fromChatId: "c", to: "b", message: "not for the waiter" })
    expect(result).toMatchObject({ ok: true, status: "queued" })
    world.fireTimers()
    expect(await waiting).toEqual({ status: "timeout" })
  })

  test("a wait that nobody answers ends with a timeout", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const waiting = messenger.waitForMessage({ chatId: "b" })
    world.fireTimers()
    expect(await waiting).toEqual({ status: "timeout" })
  })

  test("a new wait replaces the previous one, which ends with a timeout", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const first = messenger.waitForMessage({ chatId: "b" })
    const second = messenger.waitForMessage({ chatId: "b" })
    expect(await first).toEqual({ status: "timeout" })
    await messenger.send({ fromChatId: "a", to: "b", message: "for the second wait" })
    expect(await second).toMatchObject({ status: "message" })
  })

  test("a wait returns at once when a message is already pending, saying it reaches the agent when the tool returns", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    await messenger.send({ fromChatId: "a", to: "b", message: "already here" })
    world.acceptInjection = true
    const result = await messenger.waitForMessage({ chatId: "b" })
    expect(result.status).toBe("pending")
    expect(result.status === "pending" ? result.note : "").toContain("as soon as this tool returns")
    expect(world.injected).toEqual(["already here"])
  })

  test("a message sent to a chat whose wait was left over from an ended turn is delivered normally", async () => {
    const { messenger, world, endTurn } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const waiting = messenger.waitForMessage({ chatId: "b" })
    world.busy.delete("b")
    const result = await messenger.send({ fromChatId: "a", to: "b", message: "after the turn" })
    expect(result).toMatchObject({ ok: true, status: "delivered" })
    expect(await waiting).toEqual({ status: "timeout" })
    expect(world.started.map((turn) => turn.content)).toEqual(["after the turn"])
    await endTurn("b")
  })

  test("cancelling a chat ends its wait", async () => {
    const { messenger, world } = createWorld([chat("a"), chat("b")])
    world.busy.add("b")
    const waiting = messenger.waitForMessage({ chatId: "b" })
    messenger.cancelWaits("b")
    expect(await waiting).toEqual({ status: "timeout" })
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

  test("a send refused because the target's queue is full does not use up the sender's rate allowance", async () => {
    const senders = ["c", "d", "e", "f"]
    const { messenger, world, endTurn } = createWorld([chat("a"), chat("b"), ...senders.map((id) => chat(id))])
    world.busy.add("b")
    for (const sender of senders) {
      for (let index = 0; index < 5; index += 1) {
        await messenger.send({ fromChatId: sender, to: "b", message: `${sender} ${String(index)}` })
      }
    }
    const whileFull = []
    for (let index = 0; index < 6; index += 1) {
      const result = await messenger.send({ fromChatId: "a", to: "b", message: `full ${String(index)}` })
      whileFull.push(result.ok ? "ok" : result.reason)
    }
    expect(whileFull).toEqual(Array.from({ length: 6 }, () => "queue_full"))
    for (let index = 0; index <= 20; index += 1) await endTurn("b")
    const afterDrain = await messenger.send({ fromChatId: "a", to: "b", message: "now there is room" })
    expect(afterDrain).toMatchObject({ ok: true })
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
