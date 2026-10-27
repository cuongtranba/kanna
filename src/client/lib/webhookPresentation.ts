import type { InboundHandling } from "../../shared/inbound/handler"
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

const HANDLING_LABEL: Readonly<Record<InboundHandling, string>> = {
  triage: "Triage",
  task: "Run as task",
}

const HANDLING_CONSEQUENCE: Readonly<Record<InboundHandling, string>> = {
  triage: "The agent reads the message, decides whether you need to act and drafts a reply. It never does the work itself.",
  task: "The agent carries out your instruction with its tools and reports when it is done or blocked.",
}

export function webhookHandlingLabel(handling: InboundHandling): string {
  return HANDLING_LABEL[handling]
}

export function webhookHandlingConsequence(handling: InboundHandling): string {
  return HANDLING_CONSEQUENCE[handling]
}

export function webhookActionLabel(mode: WebhookMode, handling: InboundHandling | undefined): string {
  return handling === "task" && mode !== "notify" ? `${MODE_LABEL[mode]} · task` : MODE_LABEL[mode]
}

export function inboundModeLabel(mode: WebhookMode): string {
  return MODE_LABEL[mode]
}

export function inboundModeConsequence(mode: WebhookMode): string {
  return MODE_CONSEQUENCE[mode]
}

export function webhookUrl(origin: string, hookId: string): string {
  return `${origin}${webhookUrlPath(hookId)}`
}

export function describeLastDelivery(delivery: WebhookDeliveryOutcome | undefined): string {
  if (!delivery) return "No deliveries since the server started"
  if (delivery.filtered) {
    const reason = delivery.detail.replace(/^filtered: /, "")
    return `Filtered (${reason}) at ${new Date(delivery.at).toLocaleString()}`
  }
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

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]

export function isPublicHttpsOrigin(origin: string): boolean {
  const parsed = URL.canParse(origin) ? new URL(origin) : null
  if (parsed === null || parsed.protocol !== "https:") return false
  return !LOOPBACK_HOSTS.includes(parsed.hostname)
}

export function describeSavedSecret(hint: string): string {
  return `Saved secret ending …${hint}`
}

export const KEEP_SAVED_SECRET_PLACEHOLDER = "Leave blank to keep the saved secret"
