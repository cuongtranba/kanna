import { expect, test } from "bun:test"
import { createMemoryWebhookStore } from "../test-helpers/webhook-harness"
import { WEBHOOK_RATE_LIMIT_PER_MINUTE, type WebhookInput } from "../../shared/webhooks/types"
import { slackCredentialsOf, WebhookRegistry } from "./webhook-registry"

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

test("a hook's task handling is kept on create and cleared back to triage by null", async () => {
  const registry = new WebhookRegistry(createMemoryWebhookStore())
  const created = await registry.create({ ...BASE, mode: "inline", handling: "task" })
  if (!created.ok) throw new Error(created.errors.join())
  expect(created.value.hook.handling).toBe("task")
  await registry.update(created.value.hook.id, { handling: null })
  expect(registry.snapshot().hooks[0].handling).toBeUndefined()
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

const SLACK_INPUT: WebhookInput = {
  name: "Slack",
  kind: "slack",
  mode: "spawn",
  projectId: "project-1",
  template: "",
  slack: { allowedUserIds: ["UOWNER000"], signingSecret: "signing-secret-1234", botToken: "xoxb-token-5678" },
}

async function slackRegistry() {
  const store = createMemoryWebhookStore()
  const registry = new WebhookRegistry(store)
  const created = await registry.create(SLACK_INPUT)
  if (!created.ok) throw new Error(created.errors.join())
  return { store, registry, created: created.value }
}

test("a Slack hook is created without a generated secret and never exposes its credentials", async () => {
  const { registry, created } = await slackRegistry()
  expect(created.secret).toBeNull()
  expect(created.hook.slack).toEqual({ allowedUserIds: ["UOWNER000"], botTokenHint: "5678" })
  expect(created.hook.secretHint).toBe("1234")
  const serialized = JSON.stringify([registry.snapshot(), created.hook])
  expect(serialized).not.toContain("signing-secret-1234")
  expect(serialized).not.toContain("xoxb-token-5678")
})

test("editing a Slack hook with blank secrets keeps the saved ones and a new value replaces them", async () => {
  const { registry, created } = await slackRegistry()
  const id = created.hook.id
  await registry.update(id, { slack: { allowedUserIds: ["UOWNER000", "UTEAM0001"], signingSecret: "", botToken: " " } })
  const hook = registry.resolve(id)
  if (!hook) throw new Error("hook missing")
  expect(slackCredentialsOf(hook)).toEqual({
    signingSecret: "signing-secret-1234",
    botToken: "xoxb-token-5678",
    allowedUserIds: ["UOWNER000", "UTEAM0001"],
  })
  await registry.update(id, { slack: { botToken: "xoxb-new-token-9999" } })
  expect(registry.snapshot().hooks[0].slack?.botTokenHint).toBe("9999")
})

test("a Slack hook rejects a bad token, a non-spawn mode and a filter, and its secret cannot be rotated", async () => {
  const { registry, created } = await slackRegistry()
  const id = created.hook.id
  expect((await registry.update(id, { slack: { botToken: "xoxp-user-token" } })).ok).toBe(false)
  expect((await registry.update(id, { mode: "inline", chatId: "chat-1" })).ok).toBe(false)
  expect((await registry.update(id, { filter: "on: issues" })).ok).toBe(false)
  expect((await registry.rotateSecret(id)).ok).toBe(false)
  expect(registry.snapshot().hooks[0]).toMatchObject({ mode: "spawn", secretHint: "1234" })
})

test("a generic hook cannot be given Slack settings and its kind never changes", async () => {
  const registry = new WebhookRegistry(createMemoryWebhookStore())
  const created = await registry.create({ ...BASE })
  if (!created.ok) throw new Error(created.errors.join())
  expect(created.value.hook.kind).toBe("generic")
  expect(created.value.secret).toStartWith("kwh_")
  const patched = await registry.update(created.value.hook.id, { slack: { botToken: "xoxb-token-5678" } })
  expect(patched.ok).toBe(false)
})

test("admit refuses a repeated delivery id and a rate-limited delivery frees its id for the retry", () => {
  const registry = new WebhookRegistry(createMemoryWebhookStore(), () => 1_000)
  expect(registry.admit("hook", "first")).toEqual({ kind: "admitted" })
  expect(registry.admit("hook", "first")).toEqual({ kind: "duplicate" })
  for (let used = 1; used < WEBHOOK_RATE_LIMIT_PER_MINUTE; used += 1) registry.admit("hook", `fill-${used}`)
  const limited = registry.admit("hook", "overflow")
  expect(limited.kind).toBe("rate_limited")
  expect(registry.admit("hook", "overflow").kind).toBe("rate_limited")
})
