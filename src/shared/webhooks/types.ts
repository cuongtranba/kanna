import type { AgentProvider } from "../core-types"
import {
  INBOUND_HANDLER_MODES,
  INBOUND_PROMPT_BODY_MAX_CHARS,
  type InboundHandlerMode,
  type InboundHandling,
} from "../inbound/handler"

export type WebhookMode = InboundHandlerMode

export const WEBHOOK_MODES: readonly WebhookMode[] = INBOUND_HANDLER_MODES

export interface WebhookConfig {
  id: string
  name: string
  enabled: boolean
  mode: WebhookMode
  handling?: InboundHandling
  chatId?: string
  projectId?: string
  provider?: AgentProvider
  model?: string
  template: string
  threadKeyPath?: string
  senderPath?: string
  replyHint?: string
  filter?: string
  createdAt: number
  updatedAt: number
}

export interface WebhookDeliveryOutcome {
  at: number
  ok: boolean
  status: number
  detail: string
  filtered?: boolean
}

export interface WebhookSummary extends WebhookConfig {
  secretHint: string
  lastDelivery?: WebhookDeliveryOutcome
}

export interface WebhooksSnapshot {
  hooks: WebhookSummary[]
}

export interface WebhookInput {
  name: string
  mode: WebhookMode
  handling?: InboundHandling
  chatId?: string
  projectId?: string
  provider?: AgentProvider
  model?: string
  template: string
  threadKeyPath?: string
  senderPath?: string
  replyHint?: string
  filter?: string
}

export interface WebhookPatch {
  name?: string
  enabled?: boolean
  mode?: WebhookMode
  handling?: InboundHandling | null
  chatId?: string | null
  projectId?: string | null
  provider?: AgentProvider | null
  model?: string | null
  template?: string
  threadKeyPath?: string | null
  senderPath?: string | null
  replyHint?: string | null
  filter?: string | null
}

export const WEBHOOK_NAME_MAX_CHARS = 80
export const WEBHOOK_MODEL_MAX_CHARS = 200
export const WEBHOOK_TEMPLATE_MAX_CHARS = 8000
export const WEBHOOK_PROMPT_BODY_MAX_CHARS = INBOUND_PROMPT_BODY_MAX_CHARS
export const WEBHOOK_PATH_MAX_CHARS = 200
export const WEBHOOK_REPLY_HINT_MAX_CHARS = 2000
export const WEBHOOK_FILTER_MAX_CHARS = 4000
export const WEBHOOK_BODY_MAX_BYTES = 256 * 1024
export const WEBHOOK_RATE_LIMIT_PER_MINUTE = 20
export const WEBHOOK_RECENT_DELIVERY_IDS = 64
export const WEBHOOK_ROUTE_PATTERN = /^\/hooks\/([A-Za-z0-9_-]{8,64})$/

export function webhookUrlPath(hookId: string): string {
  return `/hooks/${hookId}`
}
