import { createHmac } from "node:crypto"
import { expect, test } from "bun:test"
import { createWebhookHarness } from "../test-helpers/webhook-harness"
import { handleWebhookRequest } from "./webhook-http-routes"
import { WEBHOOK_BODY_MAX_BYTES } from "../../shared/webhooks/types"

async function setup(options: { enabled?: boolean; now?: () => number } = {}) {
  const harness = await createWebhookHarness(options)
  const created = await harness.registry.create({
    name: "CI",
    mode: "inline",
    chatId: harness.chat.id,
    template: "{{repo}} {{status}}",
  })
  if (!created.ok) throw new Error(created.errors.join())
  const { hook, secret } = created.value
  const post = (headers: Record<string, string>, body: string, id = hook.id) => {
    const url = new URL(`http://localhost/hooks/${id}`)
    return handleWebhookRequest(new Request(url, { method: "POST", headers, body }), url, harness.service)
  }
  const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
  return { ...harness, hook, secret, post, sign }
}

const BODY = JSON.stringify({ repo: "kanna", status: "failed" })

test("a valid bearer secret is accepted and the prompt is queued", async () => {
  const { post, secret, store, chat } = await setup()
  const response = await post({ Authorization: `Bearer ${secret}` }, BODY)
  expect(response?.status).toBe(202)
  expect(store.getQueuedMessages(chat.id)).toHaveLength(1)
})

test("a valid HMAC signature is accepted and a tampered body is rejected", async () => {
  const { post, sign, store, chat } = await setup()
  const accepted = await post({ "X-Hub-Signature-256": sign(BODY) }, BODY)
  const tampered = await post({ "X-Hub-Signature-256": sign(BODY) }, BODY.replace("failed", "passed"))
  expect(accepted?.status).toBe(202)
  expect(tampered?.status).toBe(401)
  expect(store.getQueuedMessages(chat.id)).toHaveLength(1)
})

test("a missing or wrong secret is unauthorized and delivers nothing", async () => {
  const { post, store, chat } = await setup()
  expect((await post({}, BODY))?.status).toBe(401)
  expect((await post({ Authorization: "Bearer kwh_wrong" }, BODY))?.status).toBe(401)
  expect(store.getQueuedMessages(chat.id)).toEqual([])
})

test("unknown, disabled and globally disabled hooks all answer 404", async () => {
  const unknown = await setup()
  expect((await unknown.post({ Authorization: `Bearer ${unknown.secret}` }, BODY, "unknown-hook-id"))?.status).toBe(404)

  const disabled = await setup()
  await disabled.registry.update(disabled.hook.id, { enabled: false })
  expect((await disabled.post({ Authorization: `Bearer ${disabled.secret}` }, BODY))?.status).toBe(404)

  const off = await setup({ enabled: false })
  expect((await off.post({ Authorization: `Bearer ${off.secret}` }, BODY))?.status).toBe(404)
})

test("a body over the cap is rejected with 413", async () => {
  const { post, secret } = await setup()
  const response = await post({ Authorization: `Bearer ${secret}` }, "x".repeat(WEBHOOK_BODY_MAX_BYTES + 1))
  expect(response?.status).toBe(413)
})

test("a repeated delivery id is delivered once", async () => {
  const { post, secret, store, chat } = await setup()
  const headers = { Authorization: `Bearer ${secret}`, "X-GitHub-Delivery": "delivery-1" }
  const first = await post(headers, BODY)
  const second = await post(headers, BODY)
  expect(first?.status).toBe(202)
  expect(await second?.json()).toEqual({ ok: true, duplicate: true })
  expect(store.getQueuedMessages(chat.id)).toHaveLength(1)
})

test("the 21st delivery inside a minute is rate limited with Retry-After", async () => {
  const { post, secret } = await setup({ now: () => 1_000_000 })
  const headers = { Authorization: `Bearer ${secret}` }
  const statuses: number[] = []
  for (let i = 0; i < 21; i++) statuses.push((await post(headers, BODY))?.status ?? 0)
  expect(statuses.slice(0, 20).every((status) => status === 202)).toBe(true)
  expect(statuses[20]).toBe(429)
})

test("a path that is not a hook is left to the rest of the server", async () => {
  const { service } = await setup()
  const url = new URL("http://localhost/api/other")
  expect(await handleWebhookRequest(new Request(url, { method: "POST" }), url, service)).toBeNull()
})
