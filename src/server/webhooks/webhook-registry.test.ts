import { expect, test } from "bun:test"
import { createMemoryWebhookStore } from "../test-helpers/webhook-harness"
import { WebhookRegistry } from "./webhook-registry"

const BASE = { name: "CI", mode: "notify", chatId: "chat-1", template: "t" } as const

const REJECTED_FILTERS = [
  ["invalid YAML", "on: [issues"],
  ["an unknown top-level key", "when: issues"],
  ["a CEL syntax error", "if: body.a = 1"],
  ["an undeclared identifier", "if: foo == 1"],
  ["a YAML anchor", "on: &events issues"],
  ["a non-mapping root", "- issues"],
  ["an empty event list that would drop every delivery", "on: []"],
] as const

test.each(REJECTED_FILTERS)("a filter with %s is rejected at create", async (_label, filter) => {
  const registry = new WebhookRegistry(createMemoryWebhookStore())
  const result = await registry.create({ ...BASE, filter })
  expect(result.ok).toBe(false)
  expect(registry.snapshot().hooks).toEqual([])
})

test("an update with a bad filter is rejected and keeps the previous filter", async () => {
  const registry = new WebhookRegistry(createMemoryWebhookStore())
  const created = await registry.create({ ...BASE, filter: "on: issues" })
  if (!created.ok) throw new Error(created.errors.join())
  const updated = await registry.update(created.value.hook.id, { filter: "if: foo == 1" })
  expect(updated.ok).toBe(false)
  expect(registry.snapshot().hooks[0].filter).toBe("on: issues")
})

test("updating a filter to null clears it", async () => {
  const registry = new WebhookRegistry(createMemoryWebhookStore())
  const created = await registry.create({ ...BASE, filter: "on: issues" })
  if (!created.ok) throw new Error(created.errors.join())
  await registry.update(created.value.hook.id, { filter: null })
  const [hook] = registry.snapshot().hooks
  expect(hook.filter).toBeUndefined()
  expect(registry.matchFilter(hook.id, { body: {}, headers: new Headers() })).toEqual({ matched: true })
})

test("a stored filter that no longer compiles rejects every delivery after a reload", async () => {
  const store = createMemoryWebhookStore()
  const first = new WebhookRegistry(store)
  const created = await first.create({ ...BASE })
  if (!created.ok) throw new Error(created.errors.join())
  const stored = { ...store.saved[0], filter: "if: body.a = 1" }
  store.saved = [stored]
  const reloaded = new WebhookRegistry(store)
  await reloaded.initialize()
  const verdict = reloaded.matchFilter(stored.id, { body: {}, headers: new Headers() })
  expect(verdict).toMatchObject({ matched: false })
  expect(verdict.matched === false && verdict.reason.startsWith("filter invalid:")).toBe(true)
})

test("thread key, sender path and reply hint are kept and can be cleared", async () => {
  const registry = new WebhookRegistry(createMemoryWebhookStore())
  const created = await registry.create({ ...BASE, threadKeyPath: "issue.number", senderPath: "sender.login", replyHint: "use gh" })
  if (!created.ok) throw new Error(created.errors.join())
  expect(created.value.hook).toMatchObject({ threadKeyPath: "issue.number", senderPath: "sender.login", replyHint: "use gh" })
  const cleared = await registry.update(created.value.hook.id, { threadKeyPath: null, senderPath: null, replyHint: null })
  if (!cleared.ok) throw new Error(cleared.errors.join())
  expect(cleared.value.threadKeyPath).toBeUndefined()
  expect(cleared.value.senderPath).toBeUndefined()
  expect(cleared.value.replyHint).toBeUndefined()
})
