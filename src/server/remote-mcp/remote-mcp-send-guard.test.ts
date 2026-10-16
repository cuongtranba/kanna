import { describe, expect, test } from "bun:test"
import { createDedupeStore, DEDUPE_TTL_MS, type DedupeRecord, type DedupeTarget } from "./remote-mcp-dedupe"
import { guardedDispatch, type GuardedDispatch } from "./remote-mcp-send-guard"
import { assistantText, queuedMessage, scriptedHost, snapshotOf, userPrompt } from "./test-helpers/chat-snapshots"

const TARGET: DedupeTarget = { scope: "send", clientId: "client-1", projectId: "p-1", content: "build the feature" }
const RECORD: DedupeRecord = { chatId: "chat-1", baseline: 0 }

function setup(status: "idle" | "running" | "waiting_for_user" | "failed", queued = false) {
  let now = 1_000
  const dedupe = createDedupeStore({ now: () => now })
  const scripted = scriptedHost([snapshotOf(status, [userPrompt(10), assistantText(11, "x")], queued ? [queuedMessage("qm-1", "build the feature")] : [])])
  const dispatched: string[] = []
  const dispatch = (record: DedupeRecord = RECORD): (() => Promise<GuardedDispatch>) => async () => {
    dispatched.push(record.chatId)
    return { ok: true, record }
  }
  return {
    host: { readSnapshot: scripted.host.readSnapshot, dedupe },
    dispatched,
    dispatch,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("guardedDispatch", () => {
  test("a retried identical request is not dispatched again while the first is still running, and points at the original chat", async () => {
    const world = setup("running")

    const first = await guardedDispatch(world.host, TARGET, undefined, world.dispatch())
    const retry = await guardedDispatch(world.host, TARGET, undefined, world.dispatch({ chatId: "chat-2", baseline: 0 }))

    expect(first).toEqual({ ok: true, record: RECORD, duplicateVia: null })
    expect(retry).toEqual({ ok: true, record: RECORD, duplicateVia: "fingerprint" })
    expect(world.dispatched).toEqual(["chat-1"])
  })

  test("a request that is waiting for the user's answer still counts as in flight", async () => {
    const world = setup("waiting_for_user")

    await guardedDispatch(world.host, TARGET, undefined, world.dispatch())
    const retry = await guardedDispatch(world.host, TARGET, undefined, world.dispatch())

    expect(retry).toMatchObject({ ok: true, duplicateVia: "fingerprint" })
    expect(world.dispatched).toHaveLength(1)
  })

  test("the same words sent again after the first turn finished are a new request and are dispatched", async () => {
    const world = setup("idle")

    await guardedDispatch(world.host, TARGET, undefined, world.dispatch())
    const again = await guardedDispatch(world.host, TARGET, undefined, world.dispatch({ chatId: "chat-2", baseline: 0 }))

    expect(again).toEqual({ ok: true, record: { chatId: "chat-2", baseline: 0 }, duplicateVia: null })
    expect(world.dispatched).toEqual(["chat-1", "chat-2"])
  })

  test("an idempotency key returns the recorded chat even after its turn finished", async () => {
    const world = setup("idle")

    await guardedDispatch(world.host, TARGET, "request-42", world.dispatch())
    const retry = await guardedDispatch(world.host, TARGET, "request-42", world.dispatch({ chatId: "chat-2", baseline: 0 }))

    expect(retry).toEqual({ ok: true, record: RECORD, duplicateVia: "idempotencyKey" })
    expect(world.dispatched).toEqual(["chat-1"])
  })

  test("a different idempotency key is a different request", async () => {
    const world = setup("idle")

    await guardedDispatch(world.host, TARGET, "request-42", world.dispatch())
    await guardedDispatch(world.host, TARGET, "request-43", world.dispatch({ chatId: "chat-2", baseline: 0 }))

    expect(world.dispatched).toEqual(["chat-1", "chat-2"])
  })

  test("another client sending the same words is never treated as a duplicate", async () => {
    const world = setup("running")

    await guardedDispatch(world.host, TARGET, undefined, world.dispatch())
    await guardedDispatch(world.host, { ...TARGET, clientId: "client-2" }, undefined, world.dispatch({ chatId: "chat-2", baseline: 0 }))

    expect(world.dispatched).toEqual(["chat-1", "chat-2"])
  })

  test("two identical requests that overlap before the first is acknowledged dispatch once", async () => {
    const world = setup("running")
    let release: (value: GuardedDispatch) => void = () => {}
    const slow = new Promise<GuardedDispatch>((resolve) => {
      release = resolve
    })

    const first = guardedDispatch(world.host, TARGET, undefined, () => slow)
    const second = guardedDispatch(world.host, TARGET, undefined, world.dispatch({ chatId: "chat-2", baseline: 0 }))
    release({ ok: true, record: RECORD })

    expect(await first).toMatchObject({ duplicateVia: null })
    expect(await second).toEqual({ ok: true, record: RECORD, duplicateVia: "fingerprint" })
    expect(world.dispatched).toEqual([])
  })

  test("a send the server refused is not remembered, so the retry is dispatched", async () => {
    const world = setup("running")

    const refused = await guardedDispatch(world.host, TARGET, undefined, async () => ({ ok: false, message: "Chat not found" }))
    const retry = await guardedDispatch(world.host, TARGET, undefined, world.dispatch())

    expect(refused).toEqual({ ok: false, message: "Chat not found" })
    expect(retry).toMatchObject({ ok: true, duplicateVia: null })
    expect(world.dispatched).toEqual(["chat-1"])
  })

  test("a request older than the dedupe window is dispatched again", async () => {
    const world = setup("running")

    await guardedDispatch(world.host, TARGET, undefined, world.dispatch())
    world.advance(DEDUPE_TTL_MS + 1)
    await guardedDispatch(world.host, TARGET, undefined, world.dispatch({ chatId: "chat-2", baseline: 0 }))

    expect(world.dispatched).toEqual(["chat-1", "chat-2"])
  })

  test("a queued message that is still waiting for the chat to go idle blocks an identical enqueue", async () => {
    const world = setup("idle", true)
    const target: DedupeTarget = { scope: "enqueue", clientId: "client-1", chatId: "chat-1", content: "build the feature" }
    const queued: DedupeRecord = { chatId: "chat-1", baseline: 0, queuedMessageId: "qm-1" }

    await guardedDispatch(world.host, target, undefined, world.dispatch(queued))
    const retry = await guardedDispatch(world.host, target, undefined, world.dispatch(queued))

    expect(retry).toEqual({ ok: true, record: queued, duplicateVia: "fingerprint" })
    expect(world.dispatched).toHaveLength(1)
  })

  test("an enqueue whose earlier copy already left the queue is dispatched", async () => {
    const world = setup("idle", false)
    const target: DedupeTarget = { scope: "enqueue", clientId: "client-1", chatId: "chat-1", content: "build the feature" }
    const queued: DedupeRecord = { chatId: "chat-1", baseline: 0, queuedMessageId: "qm-1" }

    await guardedDispatch(world.host, target, undefined, world.dispatch(queued))
    await guardedDispatch(world.host, target, undefined, world.dispatch(queued))

    expect(world.dispatched).toHaveLength(2)
  })
})
