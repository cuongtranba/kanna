import { WEBHOOK_BODY_MAX_BYTES, WEBHOOK_ROUTE_PATTERN } from "../../shared/webhooks/types"
import type { WebhookService } from "./webhook-service"
import { jsonReject } from "./webhook-response"

function notFound(): Response {
  return new Response("Not Found", { status: 404 })
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
  if (raw === null) return jsonReject(413, "payload too large")
  return service.handle(hook, req.headers, raw)
}
