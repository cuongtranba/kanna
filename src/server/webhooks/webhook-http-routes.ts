import { WEBHOOK_BODY_MAX_BYTES, WEBHOOK_ROUTE_PATTERN } from "../../shared/webhooks/types"
import type { WebhookBody } from "../../shared/webhooks/template"
import { verifyWebhookRequest } from "./webhook-auth"
import type { StoredWebhook } from "./webhook-registry"
import type { WebhookService } from "./webhook-service"

const MAX_DELIVERY_ID_CHARS = 128
const DELIVERY_ID_HEADERS = ["x-github-delivery", "idempotency-key", "x-request-id"]

function notFound(): Response {
  return new Response("Not Found", { status: 404 })
}

function reject(status: number, error: string, headers?: Record<string, string>): Response {
  return Response.json({ ok: false, error }, { status, headers })
}

function pickDeliveryId(headers: Headers): string {
  for (const name of DELIVERY_ID_HEADERS) {
    const value = headers.get(name)?.trim()
    if (value) return value.slice(0, MAX_DELIVERY_ID_CHARS)
  }
  return crypto.randomUUID()
}

function parseBody(text: string): WebhookBody {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function readCappedBody(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > WEBHOOK_BODY_MAX_BYTES) return null
  if (!req.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = req.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > WEBHOOK_BODY_MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function deliver(
  service: WebhookService,
  hook: StoredWebhook,
  deliveryId: string,
  body: WebhookBody,
): Promise<Response> {
  const { registry } = service
  const outcome = (ok: boolean, status: number, detail: string) =>
    registry.recordDelivery(hook.id, { at: service.clock(), ok, status, detail })
  try {
    const result = await service.deliver(hook, deliveryId, body)
    if (!result.ok) {
      registry.releaseDelivery(hook.id, deliveryId)
      outcome(false, 409, result.detail)
      return reject(409, result.detail)
    }
    outcome(true, 202, hook.mode)
    return Response.json({ ok: true, deliveryId, chatId: result.chatId }, { status: 202 })
  } catch {
    registry.releaseDelivery(hook.id, deliveryId)
    outcome(false, 500, "delivery failed")
    return reject(500, "delivery failed")
  }
}

export async function handleWebhookRequest(
  req: Request,
  url: URL,
  service: WebhookService,
): Promise<Response | null> {
  const match = WEBHOOK_ROUTE_PATTERN.exec(url.pathname)
  if (!match) return null
  if (!service.enabled) return notFound()
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })

  const hook = service.registry.resolve(match[1])
  if (!hook || !hook.enabled) return notFound()

  const raw = await readCappedBody(req)
  if (raw === null) return reject(413, "payload too large")
  if (verifyWebhookRequest(hook.secret, req.headers, raw) !== "ok") return reject(401, "unauthorized")

  const deliveryId = pickDeliveryId(req.headers)
  if (!service.registry.claimDelivery(hook.id, deliveryId)) return Response.json({ ok: true, duplicate: true })

  const decision = service.registry.takeToken(hook.id)
  if (!decision.allowed) {
    service.registry.releaseDelivery(hook.id, deliveryId)
    return reject(429, "rate limited", { "Retry-After": String(decision.retryAfterSeconds) })
  }
  return deliver(service, hook, deliveryId, parseBody(new TextDecoder().decode(raw)))
}
