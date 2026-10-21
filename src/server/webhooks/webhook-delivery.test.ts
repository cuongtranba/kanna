import { expect, test } from "bun:test"
import { createWebhookHarness } from "../test-helpers/webhook-harness"
import { deliverWebhook } from "./webhook-delivery"
import type { WebhookConfig } from "../../shared/webhooks/types"

const BODY = { repo: "kanna", status: "failed" }

function hook(overrides: Partial<WebhookConfig>): WebhookConfig {
  return {
    id: "hook-12345678",
    name: "CI",
    enabled: true,
    kind: "generic",
    mode: "notify",
    template: "{{repo}} is {{status}}",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test("notify leaves a card with the rendered message and queues nothing", async () => {
  const { store, agent, chat, bus, inbox } = await createWebhookHarness()
  const result = await deliverWebhook(store, agent, bus, inbox, hook({ chatId: chat.id }), "d1", BODY, 10)
  expect(result).toEqual({ ok: true, chatId: chat.id })
  const cards = store.getMessages(chat.id).filter((entry) => entry.kind === "webhook_delivery")
  expect(cards).toMatchObject([{ hookName: "CI", mode: "notify", deliveryId: "d1", message: "kanna is failed" }])
  expect(store.getQueuedMessages(chat.id)).toEqual([])
})

test("inline queues the rendered prompt on the target chat under a per-delivery schedule id", async () => {
  const { store, agent, chat, startedChats, bus, inbox } = await createWebhookHarness()
  await deliverWebhook(store, agent, bus, inbox, hook({ mode: "inline", chatId: chat.id }), "d2", BODY, 10)
  const queued = store.getQueuedMessages(chat.id)
  expect(queued).toHaveLength(1)
  expect(queued[0].content).toContain("kanna is failed")
  expect(queued[0].content).toContain("external webhook data")
  expect(queued[0].autoContinue).toEqual({ scheduleId: "webhook-hook-12345678-d2" })
  expect(startedChats).toEqual([chat.id])
})

test("a hook with a provider and model queues its prompt under that provider and model", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const result = await deliverWebhook(
    store,
    agent,
    bus,
    inbox,
    hook({ mode: "spawn", projectId: project.id, provider: "codex", model: "gpt-5.4" }),
    "d6",
    BODY,
    10,
  )
  if (!result.ok) throw new Error(result.detail)
  expect(store.getQueuedMessages(result.chatId)).toMatchObject([{ provider: "codex", model: "gpt-5.4" }])
})

test("a hook without a model queues a prompt that names no provider or model", async () => {
  const { store, agent, chat, bus, inbox } = await createWebhookHarness()
  await deliverWebhook(store, agent, bus, inbox, hook({ mode: "inline", chatId: chat.id }), "d7", BODY, 10)
  const [queued] = store.getQueuedMessages(chat.id)
  expect(queued.provider).toBeUndefined()
  expect(queued.model).toBeUndefined()
})

test("spawn creates a new chat in the project holding the card and the queued prompt", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const before = store.listChatsByProject(project.id).length
  const result = await deliverWebhook(store, agent, bus, inbox, hook({ mode: "spawn", projectId: project.id }), "d3", BODY, 10)
  if (!result.ok) throw new Error(result.detail)
  expect(store.listChatsByProject(project.id)).toHaveLength(before + 1)
  expect(store.getMessages(result.chatId).some((entry) => entry.kind === "webhook_delivery")).toBe(true)
  expect(store.getQueuedMessages(result.chatId)).toHaveLength(1)
})

test("a spawn hook with task handling queues the task instruction instead of the triage one", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const result = await deliverWebhook(
    store,
    agent,
    bus,
    inbox,
    hook({ mode: "spawn", projectId: project.id, handling: "task" }),
    "d8",
    BODY,
    10,
  )
  if (!result.ok) throw new Error(result.detail)
  const [queued] = store.getQueuedMessages(result.chatId)
  expect(queued.content).toContain("You are running a task")
  expect(queued.content).not.toContain("NEVER send anything to the sender")
})

test("a missing target chat or project fails without side effects", async () => {
  const { store, agent, project, chat, bus, inbox } = await createWebhookHarness()
  const chats = store.listChatsByProject(project.id).length
  const missingChat = await deliverWebhook(store, agent, bus, inbox, hook({ mode: "inline", chatId: "gone" }), "d4", BODY, 10)
  const missingProject = await deliverWebhook(store, agent, bus, inbox, hook({ mode: "spawn", projectId: "gone" }), "d5", BODY, 10)
  expect(missingChat.ok).toBe(false)
  expect(missingProject.ok).toBe(false)
  expect(store.listChatsByProject(project.id)).toHaveLength(chats)
  expect(store.getMessages(chat.id)).toEqual([])
  expect(store.getQueuedMessages(chat.id)).toEqual([])
})
