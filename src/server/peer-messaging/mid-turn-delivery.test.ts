import { describe, expect, test } from "vite-plus/test"
import type { PeerChatOrigin } from "../../shared/command-origin"
import { PEER_MID_TURN_LIMIT } from "../../shared/peer-messaging/limits"
import type { QueuedChatMessage, TranscriptEntry } from "../../shared/types"
import { ClaudeSessionState, type ActiveTurn } from "../claude-session-state"
import { isChatBusy } from "../claude-session-state-queries"
import type { ClaudeSessionHandle } from "../harness-types"
import type { TurnRunConfig } from "../events"
import { createMidTurnDelivery } from "./mid-turn-delivery"

const CHAT = "chat-1"
const ORIGIN: PeerChatOrigin = {
  kind: "peer_chat",
  fromChatId: "chat-2",
  fromTitle: "Backend",
  fromProjectId: "project-2",
  fromProjectTitle: "API",
  messageId: "msg-1",
}

function queued(id: string, overrides: Partial<QueuedChatMessage> = {}): QueuedChatMessage {
  return { id, content: `text ${id}`, attachments: [], createdAt: 1, origin: ORIGIN, ...overrides }
}

function createWorld(options: { provider?: "claude" | "codex"; steer?: boolean; acceptPrompts?: boolean } = {}) {
  const provider = options.provider ?? "claude"
  const injectedPrompts: { id: string; content: string }[] = []
  const handle: ClaudeSessionHandle = {
    provider: "claude",
    stream: (async function* () {})(),
    interrupt: async () => {},
    close: () => {},
    closed: Promise.resolve(),
    sendPrompt: async () => {},
    injectPrompt: (id, content) => {
      if (options.acceptPrompts === false) return false
      injectedPrompts.push({ id, content })
      return true
    },
    setModel: async () => {},
    setPermissionMode: async () => {},
  }
  const session = new ClaudeSessionState({
    id: "session-1",
    chatId: CHAT,
    session: handle,
    localPath: "/project",
    additionalDirectories: [],
    model: "claude-opus-4",
    planMode: false,
    sessionToken: null,
    accountInfoLoaded: false,
    nextPromptSeq: 0,
    pendingPromptSeqs: [],
    activeTokenId: null,
    oauthKeyMasked: null,
    oauthLabel: null,
    endpointKeyMasked: null,
    endpointModel: null,
    lastUsedAt: 0,
    backgroundTasks: new Map(),
    backgroundTaskDeadlineAt: 0,
    backgroundTaskWakeCount: 0,
    backgroundTasksLevelSourced: false,
    selfWakeActive: false,
    recentToolDescriptions: new Map(),
    backgroundLaunchToolIds: new Set(),
    loopArmedAtSpawn: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    backgroundTaskWakeSuppressed: false,
  })
  const queue: QueuedChatMessage[] = []
  const transcript: TranscriptEntry[] = []
  const turnsStarted: TurnRunConfig[] = []
  const steered: { text: string; clientUserMessageId: string }[] = []
  const activeTurns = new Map<string, ActiveTurn>()
  const timers: (() => void)[] = []
  const queueStarts: string[] = []
  const claudeSessions = new Map<string, ClaudeSessionState>([[CHAT, session]])
  const delivery = createMidTurnDelivery({
    store: {
      getChat: () => ({ provider }),
      getQueuedMessages: () => queue,
      removeQueuedMessage: async (_chatId, id) => {
        const index = queue.findIndex((message) => message.id === id)
        if (index >= 0) queue.splice(index, 1)
      },
      appendMessage: async (_chatId, entry) => { transcript.push(entry) },
      recordTurnStarted: async (_chatId, runConfig) => { turnsStarted.push(runConfig) },
    },
    activeTurns,
    claudeSessions,
    steerCodexTurn: async (_chatId, text, clientUserMessageId) => {
      steered.push({ text, clientUserMessageId })
      return options.steer !== false
    },
    startNextQueued: async (chatId) => { queueStarts.push(chatId) },
    after: (_delayMs, run) => { timers.push(run) },
    emitStateChange: () => {},
  })
  const startTurn = (overrides: Partial<ActiveTurn> = {}) => {
    const active: ActiveTurn = {
      chatId: CHAT,
      provider,
      turn: { provider, stream: (async function* () {})(), interrupt: async () => {}, close: () => {} },
      startedAt: 1,
      sessionId: session.id,
      claudePromptSeq: session.beginPrompt(),
      model: "claude-opus-4",
      planMode: false,
      status: "running",
      postToolFollowUp: null,
      hasFinalResult: false,
      cancelRequested: false,
      cancelRecorded: false,
      waitStartedAt: null,
      userMessageId: "user-entry-1",
      ...overrides,
    }
    activeTurns.set(CHAT, active)
    return active
  }
  const runTimers = async () => {
    for (const run of timers.splice(0)) run()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { delivery, session, queue, transcript, turnsStarted, steered, activeTurns, injectedPrompts, startTurn, claudeSessions, queueStarts, runTimers }
}

describe("peer message delivered into a running turn", () => {
  test("Claude: the wrapped message is pushed now, and only released from the queue once the CLI reads it", async () => {
    const world = createWorld()
    world.startTurn()
    world.queue.push(queued("0b5f4f0e-0000-4000-8000-000000000001"))

    const accepted = await world.delivery.injectQueuedMessage(CHAT, "0b5f4f0e-0000-4000-8000-000000000001")

    expect(accepted).toBe(true)
    expect(world.injectedPrompts).toHaveLength(1)
    expect(world.injectedPrompts[0]?.content).toContain("<peer-chat-message")
    expect(world.queue).toHaveLength(1)
    expect(isChatBusy({ activeTurns: world.activeTurns, startingTurns: new Map(), pendingTools: new Map(), claudeSessions: world.claudeSessions }, CHAT)).toBe(true)

    await world.delivery.onPromptDelivered(world.session, "0b5f4f0e-0000-4000-8000-000000000001")

    expect(world.queue).toHaveLength(0)
    expect(world.transcript).toHaveLength(1)
    expect(world.transcript[0]).toMatchObject({ kind: "user_prompt", content: "text 0b5f4f0e-0000-4000-8000-000000000001", origin: ORIGIN })
    expect(world.session.injectedPromptIds.size).toBe(0)
    expect(world.turnsStarted).toEqual([])
  })

  test("Claude: a message the CLI starts as its own turn after the previous result becomes a Kanna turn that can finish", async () => {
    const world = createWorld()
    const id = "0b5f4f0e-0000-4000-8000-000000000002"
    world.queue.push(queued(id))
    world.session.injectedPromptIds.add(id)

    await world.delivery.onPromptDelivered(world.session, id)

    const adopted = world.activeTurns.get(CHAT)
    expect(adopted).toMatchObject({ chatId: CHAT, sessionId: "session-1", status: "running", model: "claude-opus-4", hasFinalResult: false })
    expect(adopted?.userMessageId).toBe(world.transcript[0]?._id)
    expect(adopted?.claudePromptSeq).toBe(world.session.pendingPromptSeqs[0])
    expect(world.turnsStarted).toEqual([{ provider: "claude", model: "claude-opus-4", planMode: false }])
    expect(world.queue).toHaveLength(0)
    expect(world.session.injectedPromptIds.size).toBe(0)
  })

  test("Claude: the echo of Kanna's own turn prompt is not a peer delivery and changes nothing", async () => {
    const world = createWorld()
    world.startTurn()
    world.queue.push(queued("0b5f4f0e-0000-4000-8000-000000000003"))

    await world.delivery.onPromptDelivered(world.session, "0b5f4f0e-0000-4000-8000-0000000000ff")

    expect(world.transcript).toEqual([])
    expect(world.queue).toHaveLength(1)
  })

  test("Claude: a session that cannot take the push leaves the message queued and the chat not blocked", async () => {
    const world = createWorld({ acceptPrompts: false })
    world.startTurn()
    world.queue.push(queued("0b5f4f0e-0000-4000-8000-000000000004"))

    const accepted = await world.delivery.injectQueuedMessage(CHAT, "0b5f4f0e-0000-4000-8000-000000000004")

    expect(accepted).toBe(false)
    expect(world.session.injectedPromptIds.size).toBe(0)
    expect(world.queue).toHaveLength(1)
  })

  test("Codex: the message is steered into the turn, recorded and released at once", async () => {
    const world = createWorld({ provider: "codex" })
    world.startTurn()
    world.queue.push(queued("q-1"))

    const accepted = await world.delivery.injectQueuedMessage(CHAT, "q-1")

    expect(accepted).toBe(true)
    expect(world.steered).toHaveLength(1)
    expect(world.steered[0]).toMatchObject({ clientUserMessageId: "q-1" })
    expect(world.steered[0]?.text).toContain("<peer-chat-message")
    expect(world.queue).toHaveLength(0)
    expect(world.transcript[0]).toMatchObject({ kind: "user_prompt", origin: ORIGIN })
  })

  test("Codex: a turn that cannot be steered keeps the message queued with no transcript entry", async () => {
    const world = createWorld({ provider: "codex", steer: false })
    world.startTurn()
    world.queue.push(queued("q-1"))

    const accepted = await world.delivery.injectQueuedMessage(CHAT, "q-1")

    expect(accepted).toBe(false)
    expect(world.queue).toHaveLength(1)
    expect(world.transcript).toEqual([])
  })

  test("a turn takes at most the per-turn limit of injected messages", async () => {
    const world = createWorld({ provider: "codex" })
    world.startTurn()
    const results: boolean[] = []
    for (let index = 0; index <= PEER_MID_TURN_LIMIT; index += 1) {
      world.queue.push(queued(`q-${String(index)}`))
      results.push(await world.delivery.injectQueuedMessage(CHAT, `q-${String(index)}`))
    }
    expect(results.filter(Boolean)).toHaveLength(PEER_MID_TURN_LIMIT)
    expect(results.at(-1)).toBe(false)
    expect(world.queue.map((message) => message.id)).toEqual([`q-${String(PEER_MID_TURN_LIMIT)}`])
  })

  test("a message the user queued is never injected into a running turn", async () => {
    const world = createWorld({ provider: "codex" })
    world.startTurn()
    world.queue.push(queued("q-user", { origin: undefined }))

    expect(await world.delivery.injectQueuedMessage(CHAT, "q-user")).toBe(false)
    expect(world.steered).toEqual([])
  })

  test("a turn waiting on the user's answer does not take injected messages", async () => {
    const world = createWorld({ provider: "codex" })
    world.startTurn({ status: "waiting_for_user" })
    world.queue.push(queued("q-1"))

    expect(await world.delivery.injectQueuedMessage(CHAT, "q-1")).toBe(false)
  })

  test("a chat with no running turn takes nothing, so the queue runs it as a normal turn", async () => {
    const world = createWorld({ provider: "codex" })
    world.queue.push(queued("q-1"))

    expect(await world.delivery.injectQueuedMessage(CHAT, "q-1")).toBe(false)
  })

  test("Claude: asking twice for a message already in the CLI pushes it only once", async () => {
    const world = createWorld()
    world.startTurn()
    const id = "0b5f4f0e-0000-4000-8000-000000000005"
    world.queue.push(queued(id))

    expect(await world.delivery.injectQueuedMessage(CHAT, id)).toBe(true)
    expect(await world.delivery.injectQueuedMessage(CHAT, id)).toBe(true)

    expect(world.injectedPrompts).toHaveLength(1)
  })

  test("Claude: a message the CLI never reads after the turn ends goes back to the queue instead of leaving the chat busy", async () => {
    const world = createWorld()
    const active = world.startTurn()
    const id = "0b5f4f0e-0000-4000-8000-000000000006"
    world.queue.push(queued(id))
    await world.delivery.injectQueuedMessage(CHAT, id)
    world.activeTurns.delete(active.chatId)

    world.delivery.onTurnResult(world.session)
    await world.runTimers()

    expect(world.session.injectedPromptIds.size).toBe(0)
    expect(world.queue.map((message) => message.id)).toEqual([id])
    expect(world.queueStarts).toEqual([CHAT])
  })
})
