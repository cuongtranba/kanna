import type { JsonValue } from "../json"
import {
  inboundUntrustedNotice,
  INBOUND_TRUNCATION_MARKER,
  renderInboundBlock,
  renderInboundMessage,
  renderInboundPrompt,
  substituteInboundTemplate,
} from "../inbound/template"

export type WebhookBody = JsonValue

export const WEBHOOK_UNTRUSTED_NOTICE = inboundUntrustedNotice("webhook")

export const WEBHOOK_TRUNCATION_MARKER = INBOUND_TRUNCATION_MARKER

export function substituteWebhookTemplate(template: string, body: WebhookBody): string {
  return substituteInboundTemplate(template, body)
}

export function renderWebhookBlock(body: WebhookBody): string {
  return renderInboundBlock(body, WEBHOOK_UNTRUSTED_NOTICE)
}

export function renderWebhookMessage(template: string, body: WebhookBody): string {
  return renderInboundMessage(template, body)
}

export function renderWebhookPrompt(template: string, body: WebhookBody): string {
  return renderInboundPrompt(template, body, WEBHOOK_UNTRUSTED_NOTICE)
}
