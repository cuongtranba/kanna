import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { EventStore } from "../event-store"
import { createBusTap } from "./event-store-tap"

let dataDir = ""

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-bus-tap-"))
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function attachTap(store: EventStore): BusEnvelope[] {
  const published: BusEnvelope[] = []
  store.tap = createBusTap(
    { publish: (envelope) => published.push(envelope) },
    (chatId) => store.getChat(chatId)?.projectId,
    () => 42,
  )
  return published
}

describe("event store tap", () => {
  test("creating a chat publishes one kanna.chat.created envelope carrying its chat and project", async () => {
    const store = new EventStore(dataDir)
    await store.initialize()
    const published = attachTap(store)
    const project = await store.openProject("/tmp/bus-tap-project")

    const chat = await store.createChat(project.id)

    const created = published.filter((envelope) => envelope.subject === "kanna.chat.created")
    expect(created).toHaveLength(1)
    const [envelope] = created
    expect(envelope?.chatId).toBe(chat.id)
    expect(envelope?.projectId).toBe(project.id)
    expect(envelope?.ts).toBe(42)
    expect(envelope?.direction).toBe("internal")
    expect(envelope?.source).toEqual({ kind: "store", log: "chats" })
    expect(envelope?.idempotencyKey).toMatch(new RegExp(`^store:chat_created:${chat.id}:\\d+$`))
  })

  test("a user prompt is published as a transcript envelope and an assistant reply is not", async () => {
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/bus-tap-project")
    const chat = await store.createChat(project.id)
    const published = attachTap(store)

    await store.appendMessage(chat.id, { _id: "u1", createdAt: 1, kind: "user_prompt", content: "hello" })
    await store.appendMessage(chat.id, { _id: "a1", createdAt: 2, kind: "assistant_text", text: "hi" })

    const transcript = published.filter((envelope) => envelope.subject.startsWith("kanna.transcript."))
    expect(transcript.map((envelope) => envelope.subject)).toEqual(["kanna.transcript.user_prompt"])
    expect(transcript[0]?.idempotencyKey).toBe(`transcript:${chat.id}:u1`)
    expect(transcript[0]?.source).toEqual({ kind: "transcript", chatId: chat.id })
    expect(transcript[0]?.projectId).toBe(project.id)
  })

  test("replaying the logs into a fresh store publishes nothing", async () => {
    const first = new EventStore(dataDir)
    await first.initialize()
    const project = await first.openProject("/tmp/bus-tap-project")
    await first.createChat(project.id)

    const replayed = new EventStore(dataDir)
    await replayed.initialize()
    const published = attachTap(replayed)

    expect(published).toEqual([])
    expect(replayed.state.chatsById.size).toBe(1)
  })

  test("events with no subject, such as a read-state change, publish nothing", async () => {
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/bus-tap-project")
    const chat = await store.createChat(project.id)
    const published = attachTap(store)

    await store.setChatReadState(chat.id, true)

    expect(published).toEqual([])
  })
})
