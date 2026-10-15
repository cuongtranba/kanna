import { webhookUrlPath, type WebhookDeliveryOutcome, type WebhookMode } from "../../shared/webhooks/types"

const MODE_LABEL: Readonly<Record<WebhookMode, string>> = {
  notify: "Notify",
  inline: "Run in chat",
  spawn: "New chat",
}

const MODE_CONSEQUENCE: Readonly<Record<WebhookMode, string>> = {
  notify: "Leaves a card in the chosen chat. No turn starts.",
  inline: "Leaves a card and queues the prompt in the chosen chat. It runs when the chat is idle.",
  spawn: "Creates a new chat in the chosen project, leaves a card and runs the prompt there.",
}

export function webhookModeLabel(mode: WebhookMode): string {
  return MODE_LABEL[mode]
}

export function webhookModeConsequence(mode: WebhookMode): string {
  return MODE_CONSEQUENCE[mode]
}

export function webhookUrl(origin: string, hookId: string): string {
  return `${origin}${webhookUrlPath(hookId)}`
}

export function describeLastDelivery(delivery: WebhookDeliveryOutcome | undefined): string {
  if (!delivery) return "No deliveries since the server started"
  return `${delivery.ok ? "Delivered" : "Failed"} (${delivery.status}) at ${new Date(delivery.at).toLocaleString()}`
}

export function bearerCurlSample(url: string, secret: string): string {
  return [
    `curl -X POST '${url}' \\`,
    `  -H 'Authorization: Bearer ${secret}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"status":"failed"}'`,
  ].join("\n")
}

export function hmacCurlSample(url: string, secret: string): string {
  return [
    `BODY='{"status":"failed"}'`,
    `SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '${secret}' | sed 's/^.* //')`,
    `curl -X POST '${url}' \\`,
    `  -H "X-Hub-Signature-256: sha256=$SIG" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d "$BODY"`,
  ].join("\n")
}
