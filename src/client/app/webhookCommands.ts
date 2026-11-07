import type { WebhookSummary } from "../../shared/webhooks/types"
import type { WebhookSecretReveal } from "../stores/webhooksStore"

interface CreatedWebhook {
  hook: Pick<WebhookSummary, "id" | "name">
  secret: string | null
}

export function revealCreatedWebhookSecret(created: CreatedWebhook): WebhookSecretReveal {
  const { hook, secret } = created
  if (secret !== null) return { hookId: hook.id, hookName: hook.name, secret }
  throw new Error("The server did not return a secret")
}
