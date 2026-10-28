import { randomBytes } from "node:crypto"
import { log } from "../../shared/log"
import type { InboundHandling } from "../../shared/inbound/handler"
import type { AgentProvider } from "../../shared/types"
import {
  WEBHOOK_RATE_LIMIT_PER_MINUTE,
  WEBHOOK_RECENT_DELIVERY_IDS,
  type WebhookConfig,
  type WebhookDeliveryOutcome,
  type WebhookInput,
  type WebhookKind,
  type WebhookPatch,
  type WebhookSlackPatch,
  type WebhooksSnapshot,
  type WebhookSummary,
} from "../../shared/webhooks/types"
import { mergeWebhookModel, validateWebhookInput } from "../../shared/webhooks/validate"
import {
  compileWebhookFilter,
  rejectingWebhookFilter,
  type WebhookFilter,
  type WebhookFilterInput,
  type WebhookFilterVerdict,
} from "./webhook-filter"
import { WebhookRateLimiter, type RateDecision } from "./webhook-rate-limit"

export interface StoredWebhook extends WebhookConfig {
  secret: string
  slackBotToken?: string
}

export interface SlackCredentials {
  signingSecret: string
  botToken: string
  allowedUserIds: string[]
}

export interface WebhookStorePort {
  load(): Promise<StoredWebhook[]>
  save(hooks: readonly StoredWebhook[]): Promise<void>
}

export type WebhookMutation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export type Admission =
  | { kind: "admitted" }
  | { kind: "duplicate" }
  | { kind: "rate_limited"; retryAfterSeconds: number }

export interface CreatedWebhook {
  hook: WebhookSummary
  secret: string | null
}

const SECRET_PREFIX = "kwh_"
const SECRET_HINT_CHARS = 4

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function generateWebhookId(): string {
  return randomBytes(12).toString("base64url")
}

export function slackCredentialsOf(hook: StoredWebhook): SlackCredentials | null {
  if (hook.kind !== "slack" || !hook.slackBotToken) return null
  return {
    signingSecret: hook.secret,
    botToken: hook.slackBotToken,
    allowedUserIds: [...(hook.slack?.allowedUserIds ?? [])],
  }
}

const OPTIONAL_HOOK_TEXT_FIELDS = ["chatId", "projectId", "threadKeyPath", "senderPath", "replyHint", "filter"] as const

type OptionalHookTextField = (typeof OPTIONAL_HOOK_TEXT_FIELDS)[number]

type OptionalHookFields = Pick<WebhookConfig, OptionalHookTextField | "handling" | "provider" | "model">

interface OptionalHookSource extends Partial<Record<OptionalHookTextField, string>> {
  kind?: WebhookKind
  handling?: InboundHandling
  provider?: AgentProvider
  model?: string
}

export function optionalHookFields(source: OptionalHookSource): OptionalHookFields {
  const fields: OptionalHookFields = {}
  for (const key of OPTIONAL_HOOK_TEXT_FIELDS) {
    const text = source[key]?.trim()
    if (text) fields[key] = text
  }
  if (source.kind !== "slack" && source.handling === "task") fields.handling = source.handling
  const model = source.model?.trim()
  if (source.provider && model) {
    fields.provider = source.provider
    fields.model = model
  }
  return fields
}

function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()))]
}

function inputOf(hook: StoredWebhook): WebhookInput {
  return {
    name: hook.name,
    mode: hook.mode,
    template: hook.template,
    kind: hook.kind,
    ...(hook.kind === "slack"
      ? {
          slack: {
            allowedUserIds: hook.slack?.allowedUserIds ?? [],
            signingSecret: hook.secret,
            botToken: hook.slackBotToken ?? "",
          },
        }
      : {}),
    ...optionalHookFields(hook),
  }
}

function configOf(hook: StoredWebhook): Omit<WebhookConfig, "slack"> {
  return {
    id: hook.id,
    name: hook.name,
    enabled: hook.enabled,
    kind: hook.kind,
    mode: hook.mode,
    template: hook.template,
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
    ...optionalHookFields(hook),
  }
}

export class WebhookRegistry {
  private readonly hooks = new Map<string, StoredWebhook>()
  private readonly lastDeliveries = new Map<string, WebhookDeliveryOutcome>()
  private readonly recentDeliveryIds = new Map<string, string[]>()
  private readonly filters = new Map<string, WebhookFilter>()
  private readonly listeners = new Set<() => void>()
  private readonly limiter: WebhookRateLimiter

  constructor(
    private readonly store: WebhookStorePort,
    private readonly now: () => number = Date.now,
  ) {
    this.limiter = new WebhookRateLimiter(WEBHOOK_RATE_LIMIT_PER_MINUTE, now)
  }

  async initialize(): Promise<void> {
    for (const hook of await this.store.load()) {
      this.hooks.set(hook.id, hook)
      if (!hook.filter) continue
      const compiled = compileWebhookFilter(hook.filter)
      if (compiled.ok) {
        this.filters.set(hook.id, compiled.filter)
        continue
      }
      log.warn(`[webhooks] hook ${hook.id} has a filter that no longer compiles: ${compiled.errors[0]}`)
      this.filters.set(hook.id, rejectingWebhookFilter(compiled.errors[0]))
    }
  }

  matchFilter(hookId: string, input: WebhookFilterInput): WebhookFilterVerdict {
    return this.filters.get(hookId)?.match(input) ?? { matched: true }
  }

  snapshot(): WebhooksSnapshot {
    const hooks = [...this.hooks.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((hook) => this.summarize(hook))
    return { hooks }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  resolve(hookId: string): StoredWebhook | null {
    const hook = this.hooks.get(hookId)
    return hook ? { ...hook } : null
  }

  async create(input: WebhookInput): Promise<WebhookMutation<CreatedWebhook>> {
    const errors = validateWebhookInput(input)
    if (errors.length > 0) return { ok: false, errors }
    const filter = this.compileFilter(input.filter)
    if (!filter.ok) return { ok: false, errors: filter.errors }
    const at = this.now()
    const slack = input.kind === "slack" ? input.slack : undefined
    const stored: StoredWebhook = {
      id: generateWebhookId(),
      name: input.name.trim(),
      enabled: true,
      kind: slack ? "slack" : "generic",
      mode: input.mode,
      template: input.template.trim(),
      createdAt: at,
      updatedAt: at,
      secret: slack ? slack.signingSecret.trim() : generateWebhookSecret(),
      ...(slack
        ? { slack: { allowedUserIds: dedupeIds(slack.allowedUserIds) }, slackBotToken: slack.botToken.trim() }
        : {}),
      ...optionalHookFields({ ...input, kind: slack ? "slack" : "generic" }),
    }
    this.hooks.set(stored.id, stored)
    this.setFilter(stored.id, filter.compiled)
    await this.persist()
    return { ok: true, value: { hook: this.summarize(stored), secret: slack ? null : stored.secret } }
  }

  async update(hookId: string, patch: WebhookPatch): Promise<WebhookMutation<WebhookSummary>> {
    const existing = this.hooks.get(hookId)
    if (!existing) return { ok: false, errors: ["Webhook not found"] }
    if (patch.slack !== undefined && existing.kind !== "slack") {
      return { ok: false, errors: ["Slack settings only apply to Slack hooks"] }
    }
    const merged = this.applyPatch(existing, patch)
    const errors = validateWebhookInput(inputOf(merged))
    if (errors.length > 0) return { ok: false, errors }
    const filter = patch.filter === undefined ? null : this.compileFilter(merged.filter)
    if (filter && !filter.ok) return { ok: false, errors: filter.errors }
    this.hooks.set(hookId, merged)
    if (filter) this.setFilter(hookId, filter.compiled)
    await this.persist()
    return { ok: true, value: this.summarize(merged) }
  }

  async rotateSecret(hookId: string): Promise<WebhookMutation<{ secret: string }>> {
    const existing = this.hooks.get(hookId)
    if (!existing) return { ok: false, errors: ["Webhook not found"] }
    if (existing.kind === "slack") {
      return { ok: false, errors: ["Slack hooks use the Slack signing secret; edit the hook to change it"] }
    }
    const rotated = { ...existing, secret: generateWebhookSecret(), updatedAt: this.now() }
    this.hooks.set(hookId, rotated)
    await this.persist()
    return { ok: true, value: { secret: rotated.secret } }
  }

  async delete(hookId: string): Promise<boolean> {
    if (!this.hooks.delete(hookId)) return false
    this.lastDeliveries.delete(hookId)
    this.recentDeliveryIds.delete(hookId)
    this.filters.delete(hookId)
    this.limiter.forget(hookId)
    await this.persist()
    return true
  }

  recordDelivery(hookId: string, outcome: WebhookDeliveryOutcome): void {
    if (!this.hooks.has(hookId)) return
    this.lastDeliveries.set(hookId, outcome)
    this.notify()
  }

  admit(hookId: string, deliveryId: string): Admission {
    if (!this.claimDelivery(hookId, deliveryId)) return { kind: "duplicate" }
    const decision = this.takeToken(hookId)
    if (decision.allowed) return { kind: "admitted" }
    this.releaseDelivery(hookId, deliveryId)
    return { kind: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds }
  }

  private claimDelivery(hookId: string, deliveryId: string): boolean {
    const recent = this.recentDeliveryIds.get(hookId) ?? []
    if (recent.includes(deliveryId)) return false
    recent.push(deliveryId)
    if (recent.length > WEBHOOK_RECENT_DELIVERY_IDS) recent.shift()
    this.recentDeliveryIds.set(hookId, recent)
    return true
  }

  releaseDelivery(hookId: string, deliveryId: string): void {
    const recent = this.recentDeliveryIds.get(hookId)
    if (!recent) return
    this.recentDeliveryIds.set(hookId, recent.filter((id) => id !== deliveryId))
  }

  private takeToken(hookId: string): RateDecision {
    return this.limiter.take(hookId)
  }

  private applyPatch(existing: StoredWebhook, patch: WebhookPatch): StoredWebhook {
    const next: StoredWebhook = { ...existing, updatedAt: this.now() }
    if (patch.name !== undefined) next.name = patch.name.trim()
    if (patch.enabled !== undefined) next.enabled = patch.enabled
    if (patch.mode !== undefined) next.mode = patch.mode
    if (patch.template !== undefined) next.template = patch.template.trim()
    if (patch.handling !== undefined && existing.kind !== "slack") {
      if (patch.handling === "task") next.handling = patch.handling
      else delete next.handling
    }
    if (patch.chatId !== undefined) setOrClear(next, "chatId", patch.chatId)
    if (patch.projectId !== undefined) setOrClear(next, "projectId", patch.projectId)
    if (patch.threadKeyPath !== undefined) setOrClear(next, "threadKeyPath", patch.threadKeyPath)
    if (patch.senderPath !== undefined) setOrClear(next, "senderPath", patch.senderPath)
    if (patch.replyHint !== undefined) setOrClear(next, "replyHint", patch.replyHint)
    if (patch.filter !== undefined) setOrClear(next, "filter", patch.filter)
    if (patch.slack !== undefined) applySlackPatch(next, patch.slack)
    if (patch.provider !== undefined || patch.model !== undefined) {
      const { provider, model } = mergeWebhookModel(existing, patch)
      delete next.provider
      delete next.model
      if (provider && model) {
        next.provider = provider
        next.model = model.trim()
      }
    }
    return next
  }

  private compileFilter(
    source: string | undefined,
  ): { ok: true; compiled: WebhookFilter | null } | { ok: false; errors: string[] } {
    if (!source?.trim()) return { ok: true, compiled: null }
    const result = compileWebhookFilter(source.trim())
    return result.ok ? { ok: true, compiled: result.filter } : { ok: false, errors: result.errors }
  }

  private setFilter(hookId: string, filter: WebhookFilter | null): void {
    if (filter) this.filters.set(hookId, filter)
    else this.filters.delete(hookId)
  }

  private summarize(hook: StoredWebhook): WebhookSummary {
    const lastDelivery = this.lastDeliveries.get(hook.id)
    return {
      ...configOf(hook),
      ...(hook.kind === "slack"
        ? {
            slack: {
              allowedUserIds: [...(hook.slack?.allowedUserIds ?? [])],
              botTokenHint: (hook.slackBotToken ?? "").slice(-SECRET_HINT_CHARS),
            },
          }
        : {}),
      secretHint: hook.secret.slice(-SECRET_HINT_CHARS),
      ...(lastDelivery ? { lastDelivery } : {}),
    }
  }

  private async persist(): Promise<void> {
    await this.store.save([...this.hooks.values()])
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

function applySlackPatch(target: StoredWebhook, patch: WebhookSlackPatch): void {
  if (patch.allowedUserIds !== undefined) target.slack = { allowedUserIds: dedupeIds(patch.allowedUserIds) }
  const signingSecret = patch.signingSecret?.trim()
  if (signingSecret) target.secret = signingSecret
  const botToken = patch.botToken?.trim()
  if (botToken) target.slackBotToken = botToken
}

function setOrClear(target: StoredWebhook, key: OptionalHookTextField, value: string | null): void {
  const trimmed = value?.trim()
  if (!trimmed) delete target[key]
  else target[key] = trimmed
}
