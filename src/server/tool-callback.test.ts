import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import { createToolCallbackService } from "./tool-callback"
import { createTestEventStore } from "./storage/test-helpers"

const tempDirs: string[] = []

afterEach(async () => {
  // Delay before rm so background persist tasks (fire-and-forget from auto-allow/auto-deny)
  // complete before the tmpdir vanishes. Prevents ENOENT unhandled errors in full-suite runs.
  await new Promise<void>((r) => setTimeout(r, 50))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function newTestStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-toolcb-"))
  tempDirs.push(dir)
  const store = createTestEventStore(dir)
  await store.initialize()
  return { store, dir }
}

const baseInput = {
  chatId: "chat-1",
  sessionId: "sess-1",
  toolUseId: "tu-1",
  toolName: "ask_user_question",
  args: { questions: [{ q: "ok?" }] },
  chatPolicy: POLICY_DEFAULT,
  cwd: "/tmp/project",
}

describe("tool-callback durable protocol", () => {
  test("auto-deny short-circuits with deny decision", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    const res = await svc.submit({
      ...baseInput,
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
    })
    expect(res.decision.kind).toBe("deny")
    expect(res.status).toBe("answered")
  })

  test("ask verdict creates pending record and awaits answer()", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    const pending = svc.submit(baseInput)
    // Wait one microtask flush so the fire-and-forget persistPut resolves.
    await new Promise<void>((r) => setTimeout(r, 0))
    const list = await store.listPendingToolRequests("chat-1")
    expect(list).toHaveLength(1)
    await svc.answer(list[0].id, { kind: "answer", payload: { answer: "yes" } })
    const res = await pending
    expect(res.status).toBe("answered")
    expect(res.decision.payload).toEqual({ answer: "yes" })
  })

  test("idempotent retry returns same decision without duplicating UI prompt", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    const first = svc.submit(baseInput)
    const second = svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(await store.listPendingToolRequests("chat-1")).toHaveLength(1)
    const list = await store.listPendingToolRequests("chat-1")
    await svc.answer(list[0].id, { kind: "answer", payload: 1 })
    expect((await first).decision.payload).toBe(1)
    expect((await second).decision.payload).toBe(1)
  })

  test("same toolUseId with mutated args → arg_mismatch fail closed", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    void svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    const list = await store.listPendingToolRequests("chat-1")
    await svc.answer(list[0].id, { kind: "answer", payload: "first" })

    const mutated = svc.submit({ ...baseInput, args: { questions: [{ q: "different?" }] } })
    const res = await mutated
    expect(res.status).toBe("arg_mismatch")
    expect(res.decision.kind).toBe("deny")
    expect(res.mismatchReason).toContain("canonicalArgsHash")
  })

  test("same toolUseId across different chats does NOT trip arg_mismatch", async () => {
    // Regression: claude CLI generates toolUseId starting at "1" per session,
    // so toolUseId="2" recurs in every new chat. Keying seenToolUseIds by
    // toolUseId alone treated those as retries of the first chat and denied
    // every tool call after the first chat ever made one.
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    void svc.submit({ ...baseInput, chatId: "chat-A", sessionId: "sess-A", toolUseId: "2" })
    await new Promise<void>((r) => setTimeout(r, 0))
    const listA = await store.listPendingToolRequests("chat-A")
    await svc.answer(listA[0].id, { kind: "answer", payload: "ok" })

    // Different chat, same toolUseId, different args — must not deny.
    const second = svc.submit({
      ...baseInput,
      chatId: "chat-B",
      sessionId: "sess-B",
      toolUseId: "2",
      args: { questions: [{ q: "from chat B" }] },
    })
    await new Promise<void>((r) => setTimeout(r, 0))
    const listB = await store.listPendingToolRequests("chat-B")
    expect(listB).toHaveLength(1)
    await svc.answer(listB[0].id, { kind: "answer", payload: "B-ok" })
    const res = await second
    expect(res.status).toBe("answered")
    expect(res.decision.payload).toBe("B-ok")
  })

  test("cancelAllForChat resolves all pending as canceled", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    const p = svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    await svc.cancelAllForChat("chat-1", "PTY shutdown")
    const res = await p
    expect(res.status).toBe("canceled")
  })

  test("pending records never auto-expire (timeout removed to match upstream Claude Code)", async () => {
    // Used to be a 600s wall-clock timeout fed by a 5s ticker; removed
    // because (a) upstream Claude Code has no timeout on its AskUserQuestion
    // built-in and (b) the timeout silently masked the bigger broadcast bug
    // as a "drop" — pendings that were never visible to the UI just denied
    // after 10 min instead of waiting forever for an answer. Resolution
    // now only comes from explicit answer / cancel / cancelAllForChat /
    // recoverOnStartup paths.
    const { store } = await newTestStore()
    let nowVal = 1_000
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => nowVal,
    })
    const p = svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    nowVal = 1_000 + 24 * 60 * 60 * 1000 // jump 24h
    // No tick / poll; pending must still be open.
    const list = await store.listPendingToolRequests("chat-1")
    expect(list).toHaveLength(1)
    // Resolve cleanly so the test does not leak.
    await svc.cancel(list[0].id, "test-cleanup")
    const res = await p
    expect(res.status).toBe("canceled")
  })

  test("server-restart resolves persisted pending as session_closed", async () => {
    const { store } = await newTestStore()
    const svc1 = createToolCallbackService({ store, serverSecret: "secret", now: () => 1_000 })
    void svc1.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    // Simulate restart: build a fresh service against the SAME store.
    // (in production a new EventStore would also replay; for this test re-use the same store)
    const svc2 = createToolCallbackService({ store, serverSecret: "secret", now: () => 2_000 })
    await svc2.recoverOnStartup()
    const list = await store.listPendingToolRequests("chat-1")
    expect(list).toHaveLength(0)
  })

  test("onStateChange fires on submit (ask), answer, cancel, and cancelAllForChat", async () => {
    // Regression for the missing live-broadcast bug: previously the UI only
    // saw a new pending_tool_request when an unrelated event flushed the
    // read model. Now every persisted state change triggers a chat-state
    // broadcast.
    const { store } = await newTestStore()
    const events: string[] = []
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
      onStateChange: (chatId) => events.push(chatId),
    })

    // submit (ask verdict) → 1 event
    const p1 = svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(events).toEqual(["chat-1"])

    // answer → 1 event
    const list1 = await store.listPendingToolRequests("chat-1")
    await svc.answer(list1[0].id, { kind: "answer", payload: "y" })
    await p1
    expect(events).toEqual(["chat-1", "chat-1"])

    // submit + cancel → 2 more events
    const p2 = svc.submit({ ...baseInput, toolUseId: "tu-2" })
    await new Promise<void>((r) => setTimeout(r, 0))
    const list2 = await store.listPendingToolRequests("chat-1")
    await svc.cancel(list2[0].id, "manual")
    await p2
    expect(events.length).toBe(4)

    // submit + cancelAllForChat → 2 more events (put + resolve)
    void svc.submit({ ...baseInput, toolUseId: "tu-3" })
    await new Promise<void>((r) => setTimeout(r, 0))
    await svc.cancelAllForChat("chat-1", "chat_cancelled")
    expect(events.length).toBe(6)
    expect(events.every((c) => c === "chat-1")).toBe(true)
  })

  test("onStateChange does NOT fire for auto-allow / auto-deny (no visible pending)", async () => {
    const { store } = await newTestStore()
    const events: string[] = []
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
      onStateChange: (chatId) => events.push(chatId),
    })
    await svc.submit({
      ...baseInput,
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
    })
    expect(events).toEqual([])
  })

  test("arg_mismatch record is durably persisted before submit returns", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({
      store, serverSecret: "secret", now: () => 1_000,
    })
    void svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    const list = await store.listPendingToolRequests("chat-1")
    await svc.answer(list[0].id, { kind: "answer", payload: "ok" })

    await svc.submit({ ...baseInput, args: { questions: [{ q: "diff" }] } })
    // After await returns, mismatch record must be persisted in store.
    const all = await store.scanAllToolRequests()
    const mismatch = all.find((r) => r.status === "arg_mismatch")
    expect(mismatch).toBeDefined()
    expect(mismatch?.toolUseId).toBe("tu-1")
  })
})

describe("tool-callback pending dedup (duplicate ask prevention)", () => {
  test("re-delivered pending ask with a new toolUseId does not duplicate the pending record", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({ store, serverSecret: "secret", now: () => 1_000 })

    const first = svc.submit(baseInput) // toolUseId tu-1
    const second = svc.submit({ ...baseInput, toolUseId: "tu-2" }) // re-delivery, same content
    await new Promise<void>((r) => setTimeout(r, 0))

    const pending = await store.listPendingToolRequests("chat-1")
    expect(pending).toHaveLength(1)

    // Answering the single live record resolves BOTH waiters.
    await svc.answer(pending[0].id, { kind: "answer", payload: { ok: true } })
    expect((await first).status).toBe("answered")
    expect((await second).status).toBe("answered")
  })

  test("an identical ask issued AFTER the prior is answered creates a fresh pending record", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({ store, serverSecret: "secret", now: () => 1_000 })

    const first = svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    const p1 = await store.listPendingToolRequests("chat-1")
    expect(p1).toHaveLength(1)
    await svc.answer(p1[0].id, { kind: "answer", payload: { ok: true } })
    await first

    // Same content, new delivery, AFTER resolution → must NOT be suppressed.
    const second = svc.submit({ ...baseInput, toolUseId: "tu-9" })
    await new Promise<void>((r) => setTimeout(r, 0))
    const p2 = await store.listPendingToolRequests("chat-1")
    expect(p2).toHaveLength(1)
    expect(p2[0].status).toBe("pending")

    await svc.answer(p2[0].id, { kind: "answer", payload: { ok: true } })
    expect((await second).status).toBe("answered")
  })

  test("cancelAllForChat clears the dedup index so a later ask re-prompts", async () => {
    const { store } = await newTestStore()
    const svc = createToolCallbackService({ store, serverSecret: "secret", now: () => 1_000 })

    const first = svc.submit(baseInput)
    await new Promise<void>((r) => setTimeout(r, 0))
    await svc.cancelAllForChat("chat-1", "user-cancel")
    expect((await first).status).toBe("canceled")

    const second = svc.submit({ ...baseInput, toolUseId: "tu-7" })
    await new Promise<void>((r) => setTimeout(r, 0))
    const pending = await store.listPendingToolRequests("chat-1")
    expect(pending).toHaveLength(1)
    await svc.answer(pending[0].id, { kind: "answer", payload: { ok: true } })
    expect((await second).status).toBe("answered")
  })
})
