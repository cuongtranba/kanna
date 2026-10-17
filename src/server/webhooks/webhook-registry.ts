import { randomBytes } from "node:crypto"
import {
  WEBHOOK_RATE_LIMIT_PER_MINUTE,
  WEBHOOK_RECENT_DELIVERY_IDS,
  type WebhookConfig,
  type WebhookDeliveryOutcome,
  type WebhookInput,
  type WebhookPatch,
  type WebhooksSnapshot,
  type WebhookSummary,
} from "../../shared/webhooks/types"
import { mergeWebhookModel, validateWebhookInput } from "../../shared/webhooks/validate"
import { WebhookRateLimiter, type RateDecision } from "./webhook-rate-limit"

export interface StoredWebhook extends WebhookConfig {
  secret: string
}

export interface WebhookStorePort {
  load(): Promise<StoredWebhook[]>
  save(hooks: readonly StoredWebhook[]): Promise<void>
}

export type WebhookMutation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface CreatedWebhook {
  hook: WebhookSummary
  secret: string
}

const SECRET_PREFIX = "kwh_"
const SECRET_HINT_CHARS = 4

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function generateWebhookId(): string {
  return randomBytes(12).toString("base64url")
}

function configOf(hook: StoredWebhook): WebhookConfig {
  return {
    id: hook.id,
    name: hook.name,
    enabled: hook.enabled,
    mode: hook.mode,
    template: hook.template,
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
    ...(hook.chatId ? { chatId: hook.chatId } : {}),
    ...(hook.projectId ? { projectId: hook.projectId } : {}),
    ...(hook.provider && hook.model ? { provider: hook.provider, model: hook.model } : {}),
  }
}

export class WebhookRegistry {
  private readonly hooks = new Map<string, StoredWebhook>()
  private readonly lastDeliveries = new Map<string, WebhookDeliveryOutcome>()
  private readonly recentDeliveryIds = new Map<string, string[]>()
  private readonly listeners = new Set<() => void>()
  private readonly limiter: WebhookRateLimiter

  constructor(
    private readonly store: WebhookStorePort,
    private readonly now: () => number = Date.now,
  ) {
    this.limiter = new WebhookRateLimiter(WEBHOOK_RATE_LIMIT_PER_MINUTE, now)
  }

  async initialize(): Promise<void> {
    for (const hook of await this.store.load()) this.hooks.set(hook.id, hook)
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
    const at = this.now()
    const stored: StoredWebhook = {
      id: generateWebhookId(),
      name: input.name.trim(),
      enabled: true,
      mode: input.mode,
      template: input.template.trim(),
      createdAt: at,
      updatedAt: at,
      secret: generateWebhookSecret(),
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.provider && input.model ? { provider: input.provider, model: input.model.trim() } : {}),
    }
    this.hooks.set(stored.id, stored)
    await this.persist()
    return { ok: true, value: { hook: this.summarize(stored), secret: stored.secret } }
  }

  async update(hookId: string, patch: WebhookPatch): Promise<WebhookMutation<WebhookSummary>> {
    const existing = this.hooks.get(hookId)
    if (!existing) return { ok: false, errors: ["Webhook not found"] }
    const merged = this.applyPatch(existing, patch)
    const errors = validateWebhookInput(merged)
    if (errors.length > 0) return { ok: false, errors }
    this.hooks.set(hookId, merged)
    await this.persist()
    return { ok: true, value: this.summarize(merged) }
  }

  async rotateSecret(hookId: string): Promise<WebhookMutation<{ secret: string }>> {
    const existing = this.hooks.get(hookId)
    if (!existing) return { ok: false, errors: ["Webhook not found"] }
    const rotated = { ...existing, secret: generateWebhookSecret(), updatedAt: this.now() }
    this.hooks.set(hookId, rotated)
    await this.persist()
    return { ok: true, value: { secret: rotated.secret } }
  }

  async delete(hookId: string): Promise<boolean> {
    if (!this.hooks.delete(hookId)) return false
    this.lastDeliveries.delete(hookId)
    this.recentDeliveryIds.delete(hookId)
    this.limiter.forget(hookId)
    await this.persist()
    return true
  }

  recordDelivery(hookId: string, outcome: WebhookDeliveryOutcome): void {
    if (!this.hooks.has(hookId)) return
    this.lastDeliveries.set(hookId, outcome)
    this.notify()
  }

  claimDelivery(hookId: string, deliveryId: string): boolean {
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

  takeToken(hookId: string): RateDecision {
    return this.limiter.take(hookId)
  }

  private applyPatch(existing: StoredWebhook, patch: WebhookPatch): StoredWebhook {
    const next: StoredWebhook = { ...existing, updatedAt: this.now() }
    if (patch.name !== undefined) next.name = patch.name.trim()
    if (patch.enabled !== undefined) next.enabled = patch.enabled
    if (patch.mode !== undefined) next.mode = patch.mode
    if (patch.template !== undefined) next.template = patch.template.trim()
    if (patch.chatId !== undefined) setOrClear(next, "chatId", patch.chatId)
    if (patch.projectId !== undefined) setOrClear(next, "projectId", patch.projectId)
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

  private summarize(hook: StoredWebhook): WebhookSummary {
    const lastDelivery = this.lastDeliveries.get(hook.id)
    return {
      ...configOf(hook),
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

function setOrClear(target: StoredWebhook, key: "chatId" | "projectId", value: string | null): void {
  if (value === null || value === "") delete target[key]
  else target[key] = value
}
