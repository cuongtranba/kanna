import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ClaudeModelOptions, Subagent } from "../shared/types"
import { EventStore } from "./event-store"
import {
  SubagentOrchestrator,
  type OrchestratorAppSettings,
  type ProviderRunStart,
} from "./subagent-orchestrator"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDataDir() {
  const dir = await mkdtemp(join(tmpdir(), "kanna-orchestrator-"))
  tempDirs.push(dir)
  return dir
}

function makeSubagent(over: Partial<Subagent> = {}): Subagent {
  const modelOptions: ClaudeModelOptions = { reasoningEffort: "medium", contextWindow: "1m" }
  return {
    id: over.id ?? "sa-1",
    name: over.name ?? "alpha",
    provider: over.provider ?? "claude",
    model: over.model ?? "claude-opus-4-7",
    modelOptions: over.modelOptions ?? modelOptions,
    systemPrompt: over.systemPrompt ?? "You are alpha.",
    contextScope: over.contextScope ?? "previous-assistant-reply",
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
    ...(over.description !== undefined ? { description: over.description } : {}),
  }
}

interface ProviderProgram {
  authReady?: boolean
  reply?: string
  chunks?: string[]
  hold?: boolean
  error?: string
}

interface OrchestratorHarness {
  store: EventStore
  appSettings: OrchestratorAppSettings
  orchestrator: SubagentOrchestrator
  chatId: string
  userMessageId: string
  programs: Map<string, ProviderProgram>
  programReply: (subagentId: string, reply: string) => void
  holdReply: (subagentId: string) => void
  resolveReply: (subagentId: string, reply: string) => void
  setAuthReady: (subagentId: string, ready: boolean) => void
  activeStarts: { value: number; max: number }
  pendingHolds: Map<string, (text: string) => void>
}

async function setupHarness(opts: {
  subagents: Subagent[]
  maxParallel?: number
  maxChainDepth?: number
  runTimeoutMs?: number
}): Promise<OrchestratorHarness> {
  const dataDir = await createTempDataDir()
  const store = new EventStore(dataDir)
  await store.initialize()
  const project = await store.openProject("/tmp/p-orch")
  const chat = await store.createChat(project.id)

  let subagents = opts.subagents
  const appSettings: OrchestratorAppSettings = {
    getSnapshot: () => ({ subagents }),
  }

  const programs = new Map<string, ProviderProgram>()
  for (const s of subagents) programs.set(s.id, { authReady: true, reply: "ok" })

  const activeStarts = { value: 0, max: 0 }
  const pendingHolds = new Map<string, (text: string) => void>()

  let nowCounter = chat.createdAt + 1
  const orchestrator = new SubagentOrchestrator({
    store,
    appSettings,
    now: () => nowCounter++,
    maxParallel: opts.maxParallel,
    maxChainDepth: opts.maxChainDepth,
    runTimeoutMs: opts.runTimeoutMs,
    startProviderRun: ({ subagent }): ProviderRunStart => {
      const prog = programs.get(subagent.id) ?? { authReady: true, reply: "" }
      return {
        provider: subagent.provider,
        model: subagent.model,
        systemPrompt: subagent.systemPrompt,
        preamble: null,
        authReady: async () => prog.authReady ?? true,
        async start(onChunk) {
          activeStarts.value += 1
          if (activeStarts.value > activeStarts.max) activeStarts.max = activeStarts.value
          try {
            if (prog.chunks) {
              for (const c of prog.chunks) onChunk(c)
            }
            if (prog.error) throw new Error(prog.error)
            if (prog.hold) {
              const text = await new Promise<string>((resolve) => {
                pendingHolds.set(subagent.id, resolve)
              })
              return { text }
            }
            return { text: prog.reply ?? "" }
          } finally {
            activeStarts.value -= 1
          }
        },
      }
    },
  })

  return {
    store,
    appSettings,
    orchestrator,
    chatId: chat.id,
    userMessageId: "u1",
    programs,
    programReply: (id, reply) => {
      programs.set(id, { ...(programs.get(id) ?? {}), reply, authReady: programs.get(id)?.authReady ?? true })
    },
    holdReply: (id) => {
      programs.set(id, { ...(programs.get(id) ?? {}), hold: true, authReady: programs.get(id)?.authReady ?? true })
    },
    resolveReply: (id, reply) => {
      const resolver = pendingHolds.get(id)
      if (resolver) {
        pendingHolds.delete(id)
        resolver(reply)
      }
    },
    setAuthReady: (id, ready) => {
      programs.set(id, { ...(programs.get(id) ?? {}), authReady: ready })
    },
    activeStarts,
    pendingHolds,
  }
}

describe("SubagentOrchestrator", () => {
  test("runs single mention and emits started + completed", async () => {
    const h = await setupHarness({ subagents: [makeSubagent({})] })
    h.programReply("sa-1", "hello")
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-1", raw: "@agent/alpha" }],
    })
    const runs = Object.values(h.store.getSubagentRuns(h.chatId))
    expect(runs).toHaveLength(1)
    expect(runs[0].subagentId).toBe("sa-1")
    expect(runs[0].status).toBe("completed")
    expect(runs[0].depth).toBe(0)
    expect(runs[0].finalText).toBe("hello")
  })

  test("UNKNOWN_SUBAGENT emitted for unknown-subagent mention", async () => {
    const h = await setupHarness({ subagents: [] })
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "unknown-subagent", name: "nobody", raw: "@agent/nobody" }],
    })
    const runs = Object.values(h.store.getSubagentRuns(h.chatId))
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe("failed")
    expect(runs[0].error?.code).toBe("UNKNOWN_SUBAGENT")
    expect(runs[0].subagentId).toBeNull()
  })

  test("parallel fan-out caps at maxParallel=2", async () => {
    const subagents = [1, 2, 3, 4].map((i) => makeSubagent({ id: `sa-${i}`, name: `a${i}` }))
    const h = await setupHarness({ subagents, maxParallel: 2 })
    for (const s of subagents) h.holdReply(s.id)
    const mentions = subagents.map((s) => ({ kind: "subagent" as const, subagentId: s.id, raw: `@agent/${s.name}` }))
    const promise = h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions,
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.activeStarts.max).toBeLessThanOrEqual(2)

    let resolvedCount = 0
    while (resolvedCount < subagents.length) {
      await new Promise((r) => setTimeout(r, 10))
      for (const id of Array.from(h.pendingHolds.keys())) {
        h.resolveReply(id, "done")
        resolvedCount += 1
      }
    }
    await promise
    expect(h.activeStarts.max).toBeLessThanOrEqual(2)
  })

  test("DEPTH_EXCEEDED when chained at depth>1", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const beta = makeSubagent({ id: "sa-b", name: "beta" })
    const gamma = makeSubagent({ id: "sa-c", name: "gamma" })
    const h = await setupHarness({ subagents: [alpha, beta, gamma] })
    h.programReply("sa-a", "delegate to @agent/beta")
    h.programReply("sa-b", "now go to @agent/gamma")
    h.programReply("sa-c", "leaf")
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(h.store.getSubagentRuns(h.chatId))
    const depthExceeded = runs.find((r) => r.error?.code === "DEPTH_EXCEEDED")
    expect(depthExceeded).toBeDefined()
    expect(depthExceeded?.depth).toBe(2)
  })

  test("LOOP_DETECTED when chained run mentions an ancestor subagent", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const h = await setupHarness({ subagents: [alpha] })
    h.programReply("sa-a", "delegate to @agent/alpha")
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(h.store.getSubagentRuns(h.chatId))
    const loop = runs.find((r) => r.error?.code === "LOOP_DETECTED")
    expect(loop).toBeDefined()
  })

  test("AUTH_REQUIRED when provider auth fails", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha", provider: "codex" })
    const h = await setupHarness({ subagents: [alpha] })
    h.setAuthReady("sa-a", false)
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(h.store.getSubagentRuns(h.chatId))
    expect(runs[0].error?.code).toBe("AUTH_REQUIRED")
  })

  test("TIMEOUT cancels run after runTimeoutMs", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const h = await setupHarness({ subagents: [alpha], runTimeoutMs: 30 })
    h.holdReply("sa-a")
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(h.store.getSubagentRuns(h.chatId))
    expect(runs[0].error?.code).toBe("TIMEOUT")
    // unblock the stuck provider so harness teardown is clean
    h.resolveReply("sa-a", "late")
  })

  test("snapshots subagentName at start - rename mid-run is irrelevant to recorded event", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const h = await setupHarness({ subagents: [alpha] })
    h.programReply("sa-a", "ok")
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const run = Object.values(h.store.getSubagentRuns(h.chatId))[0]
    expect(run.subagentName).toBe("alpha")
  })

  test("provider chunks become subagent_message_delta events in order", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const h = await setupHarness({ subagents: [alpha] })
    h.programs.set("sa-a", { authReady: true, chunks: ["Hello ", "world", "!"], reply: "Hello world!" })
    await h.orchestrator.runMentionsForUserMessage({
      chatId: h.chatId,
      userMessageId: h.userMessageId,
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const run = Object.values(h.store.getSubagentRuns(h.chatId))[0]
    expect(run.status).toBe("completed")
    expect(run.finalText).toBe("Hello world!")
  })
})
