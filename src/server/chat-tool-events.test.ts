import { describe, expect, test } from "vite-plus/test"
import { AgentCoordinator } from "./agent-coordinator"
import { EventStore } from "./event-store"
import { createBusTap } from "./service-bus/event-store-tap"
import { createInMemoryServiceBus } from "./service-bus/in-memory-service-bus"
import { InMemoryStorageBackend } from "./storage/in-memory-storage"
import { parkingClaudeSession, PARKED_QUESTION_ID, PARKED_QUESTIONS } from "./test-helpers/parking-claude-session"
import { waitFor } from "./test-helpers/wait-for"
import { isJsonObject, type JsonObject } from "../shared/json"
import type { BusEnvelope } from "../shared/service-bus/envelope"

async function parkedTurn() {
  const store = new EventStore("/virtual-chat-tool-events", new InMemoryStorageBackend())
  await store.initialize()
  const bus = createInMemoryServiceBus()
  store.tap = createBusTap(bus, (chatId) => store.getChat(chatId)?.projectId, Date.now)
  const observed: BusEnvelope[] = []
  bus.subscribe("kanna.chat.>", (envelope) => {
    observed.push(envelope)
  })
  const session = parkingClaudeSession()
  const coordinator = new AgentCoordinator({ store, onStateChange: () => {}, startClaudeSession: session.start })
  const project = await store.openProject("/tmp/chat-tool-events", "Project")
  const chat = await store.createChat(project.id)
  await coordinator.send({ type: "chat.send", chatId: chat.id, provider: "claude", content: "ask me something" })
  await waitFor(() => coordinator.getPendingTool(chat.id) !== null, 2000, "parked tool")
  return { store, coordinator, chat, observed }
}

function payloadOf(envelope: BusEnvelope | undefined): JsonObject {
  const payload = envelope?.payload
  if (payload === undefined || !isJsonObject(payload)) throw new Error("expected an object payload")
  return payload
}

describe("interactive tool events on the bus", () => {
  test("a parked AskUserQuestion is published as toolPending and answering it publishes toolResolved by the user", async () => {
    const { coordinator, chat, observed } = await parkedTurn()

    const pending = observed.find((envelope) => envelope.subject === "kanna.chat.toolPending")
    expect(pending?.chatId).toBe(chat.id)
    expect(payloadOf(pending)).toMatchObject({ toolUseId: PARKED_QUESTION_ID, toolKind: "ask_user_question", input: { questions: PARKED_QUESTIONS } })

    await coordinator.respondTool({
      type: "chat.respondTool",
      chatId: chat.id,
      toolUseId: PARKED_QUESTION_ID,
      result: { questions: PARKED_QUESTIONS, answers: { provider: ["claude"] } },
    })

    const resolved = observed.find((envelope) => envelope.subject === "kanna.chat.toolResolved")
    expect(resolved?.chatId).toBe(chat.id)
    expect(payloadOf(resolved)).toMatchObject({ toolUseId: PARKED_QUESTION_ID, resolution: "user" })
  })

  test("cancelling a parked turn publishes toolResolved as interrupted", async () => {
    const { coordinator, chat, observed } = await parkedTurn()

    await coordinator.cancel(chat.id)

    const resolved = observed.find((envelope) => envelope.subject === "kanna.chat.toolResolved")
    expect(payloadOf(resolved)).toMatchObject({ toolUseId: PARKED_QUESTION_ID, resolution: "interrupted" })
  })
})
