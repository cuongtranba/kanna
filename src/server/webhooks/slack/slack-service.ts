import { isJsonObject, safeJsonParse, type JsonValue } from "../../../shared/json"
import { log } from "../../../shared/log"
import { busSubject, type BusEnvelope } from "../../../shared/service-bus/envelope"
import type { TranscriptEntry } from "../../../shared/types"
import type { AgentCoordinator } from "../../agent-coordinator"
import type { EventStore } from "../../event-store"
import type { ServiceBus } from "../../service-bus/service-bus"
import { slackCredentialsOf, type SlackCredentials, type StoredWebhook, type WebhookRegistry } from "../webhook-registry"
import type { SlackApi, SlackThreadMessage } from "./slack-api"
import {
  classifySlackEvent,
  decodeSlackText,
  parseSlackEnvelope,
  stripBotMention,
  type SlackEventCallback,
  type SlackMention,
} from "./slack-events"
import {
  finalReplyAfterSlackPrompt,
  formatSlackContext,
  isSlackScheduleFor,
  renderSlackPrompt,
  replyForSlackSchedule,
  slackScheduleId,
  SLACK_EMPTY_INSTRUCTION,
  splitSlackReply,
  type SlackTurnReply,
} from "./slack-prompt"
import { verifySlackSignature } from "./slack-signature"
import { SlackTaskTracker } from "./slack-task-tracker"
import { slackThreadKey, type SlackThreadRegistry, type SlackThreadTarget } from "./slack-threads"

export type SlackStore = Pick<EventStore, "getChat" | "getProject" | "createChat" | "renameChat" | "getMessages">
export type SlackAgent = Pick<AgentCoordinator, "enqueueMessage" | "maybeStartNextQueuedMessage">
export type SlackHookRegistry = Pick<
  WebhookRegistry,
  "resolve" | "claimDelivery" | "releaseDelivery" | "takeToken" | "recordDelivery"
>

type TurnOutcome = "finished" | "failed" | "cancelled"

const TURN_SUBJECTS = new Map<string, TurnOutcome>([
  [busSubject("turn", "finished"), "finished"],
  [busSubject("turn", "failed"), "failed"],
  [busSubject("turn", "cancelled"), "cancelled"],
])
const CHAT_DELETED_SUBJECT = busSubject("chat", "deleted")
const USER_PROMPT_SUBJECT = busSubject("transcript", "user_prompt")
const WORKING_REACTION = "eyes"
const TITLE_EXCERPT_CHARS = 40

function reject(status: number, error: string, headers?: Record<string, string>): Response {
  return Response.json({ ok: false, error }, { status, headers })
}

function titleExcerpt(instruction: string): string {
  const line = instruction.replace(/\s+/g, " ").trim()
  return line.length > TITLE_EXCERPT_CHARS ? `${line.slice(0, TITLE_EXCERPT_CHARS - 1)}…` : line
}

function scheduleIdOf(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null
  const { autoContinue } = payload
  return isJsonObject(autoContinue) && typeof autoContinue.scheduleId === "string" ? autoContinue.scheduleId : null
}

function failureText(payload: JsonValue): string {
  const error = isJsonObject(payload) && typeof payload.error === "string" ? payload.error : "unknown error"
  return `Kanna turn failed: ${error}`
}

export class SlackService {
  private readonly tasks = new SlackTaskTracker()
  private readonly lanes = new Map<string, Promise<void>>()
  private readonly currentScheduleIds = new Map<string, string | null>()
  private unsubscribes: Array<() => void> = []

  constructor(
    private readonly registry: SlackHookRegistry,
    private readonly store: SlackStore,
    private readonly agent: SlackAgent,
    private readonly bus: Pick<ServiceBus, "publish" | "subscribe">,
    private readonly threads: SlackThreadRegistry,
    private readonly api: SlackApi,
    private readonly now: () => number = Date.now,
  ) {}

  async start(): Promise<void> {
    await this.threads.initialize()
    this.stop()
    const subjects = [...TURN_SUBJECTS.keys(), CHAT_DELETED_SUBJECT, USER_PROMPT_SUBJECT]
    this.unsubscribes = subjects.map((subject) => this.bus.subscribe(subject, (envelope) => this.onBus(envelope)))
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes = []
    this.currentScheduleIds.clear()
  }

  flush(): Promise<void> {
    return this.tasks.flush()
  }

  handleRequest(hook: StoredWebhook, headers: Headers, raw: Uint8Array): Response {
    const credentials = slackCredentialsOf(hook)
    if (credentials === null || verifySlackSignature(credentials.signingSecret, headers, raw, this.now()) !== "ok") {
      return reject(401, "unauthorized")
    }
    const envelope = parseSlackEnvelope(safeJsonParse(new TextDecoder().decode(raw)))
    if (envelope.kind === "url_verification") return Response.json({ challenge: envelope.challenge })
    if (envelope.kind === "other") return this.ignored(hook.id, "unsupported payload")
    if (!this.registry.claimDelivery(hook.id, envelope.eventId)) return Response.json({ ok: true, duplicate: true })
    const verdict = classifySlackEvent(envelope, credentials.allowedUserIds)
    if (verdict.kind === "ignore") return this.ignored(hook.id, verdict.reason)
    const decision = this.registry.takeToken(hook.id)
    if (!decision.allowed) {
      this.registry.releaseDelivery(hook.id, envelope.eventId)
      return reject(429, "rate limited", { "Retry-After": String(decision.retryAfterSeconds) })
    }
    this.record(hook.id, true, 200, "slack mention queued")
    const target = this.targetOf(hook.id, envelope, verdict.mention)
    this.tasks.run(
      () => this.lane(slackThreadKey(target), () => this.command(hook, credentials, envelope, verdict.mention, target)),
      (error) => {
        log.error(`[slack] hook ${hook.id} command failed: ${error.message}`)
        this.record(hook.id, false, 500, `slack command failed: ${error.message}`)
      },
    )
    return Response.json({ ok: true })
  }

  private ignored(hookId: string, reason: string): Response {
    this.record(hookId, true, 200, `ignored: ${reason}`)
    return Response.json({ ok: true, ignored: true })
  }

  private record(hookId: string, ok: boolean, status: number, detail: string): void {
    this.registry.recordDelivery(hookId, { at: this.now(), ok, status, detail })
  }

  private targetOf(hookId: string, envelope: SlackEventCallback, mention: SlackMention): SlackThreadTarget {
    return { hookId, teamId: envelope.teamId, channel: mention.channel, threadTs: mention.threadTs }
  }

  private lane(key: string, task: () => Promise<void>): Promise<void> {
    const run = (this.lanes.get(key) ?? Promise.resolve()).then(task)
    const tail: Promise<void> = run.then(
      () => this.release(key, tail),
      () => this.release(key, tail),
    )
    this.lanes.set(key, tail)
    return run
  }

  private release(key: string, tail: Promise<void>): void {
    if (this.lanes.get(key) === tail) this.lanes.delete(key)
  }

  private async react(token: string, channel: string, ts: string, name: string, remove = false): Promise<void> {
    if (ts === "") return
    const result = remove
      ? await this.api.removeReaction(token, channel, ts, name)
      : await this.api.addReaction(token, channel, ts, name)
    if (!result.ok) log.warn(`[slack] reaction ${name} failed: ${result.error}`)
  }

  private async contextFor(
    credentials: SlackCredentials,
    envelope: SlackEventCallback,
    mention: SlackMention,
    lastSeenTs: string | null,
  ): Promise<{ text: string | null; seenTs: string }> {
    const fetched = await this.api.replies(credentials.botToken, mention.channel, mention.threadTs)
    if (!fetched.ok) {
      log.warn(`[slack] could not fetch thread context: ${fetched.error}`)
      return { text: null, seenTs: mention.ts }
    }
    const isNew = (message: SlackThreadMessage) => lastSeenTs === null || Number(message.ts) > Number(lastSeenTs)
    const others = fetched.value.filter(
      (message) => message.ts !== mention.ts && message.user !== envelope.botUserId && isNew(message),
    )
    const newest = fetched.value.reduce((max, message) => (Number(message.ts) > Number(max) ? message.ts : max), mention.ts)
    return { text: formatSlackContext(others), seenTs: newest }
  }

  private async chatFor(hook: StoredWebhook, target: SlackThreadTarget, title: string): Promise<{ chatId: string; continuing: boolean }> {
    const existing = this.threads.byThread(target)
    if (existing && this.store.getChat(existing.chatId)) return { chatId: existing.chatId, continuing: true }
    if (!hook.projectId || !this.store.getProject(hook.projectId)) throw new Error("target project not found")
    const chat = await this.store.createChat(hook.projectId)
    await this.store.renameChat(chat.id, `Slack · ${title}`)
    await this.threads.bind(target, chat.id)
    return { chatId: chat.id, continuing: false }
  }

  private publishDelivery(hook: StoredWebhook, envelope: SlackEventCallback, chatId: string): void {
    this.bus.publish({
      v: 1,
      id: crypto.randomUUID(),
      subject: busSubject("webhook", hook.id, "delivery"),
      ts: this.now(),
      source: { kind: "webhook", hookId: hook.id, hookName: hook.name },
      direction: "inbound",
      idempotencyKey: `webhook:${hook.id}:${envelope.eventId}`,
      chatId,
      payload: { event_id: envelope.eventId, team_id: envelope.teamId, event: envelope.event },
    })
  }

  private async command(
    hook: StoredWebhook,
    credentials: SlackCredentials,
    envelope: SlackEventCallback,
    mention: SlackMention,
    target: SlackThreadTarget,
  ): Promise<void> {
    await this.react(credentials.botToken, mention.channel, mention.ts, WORKING_REACTION)
    const instruction = decodeSlackText(stripBotMention(mention.text, envelope.botUserId)).trim() || SLACK_EMPTY_INSTRUCTION
    const { chatId, continuing } = await this.chatFor(hook, target, titleExcerpt(instruction))
    const context = await this.contextFor(
      credentials,
      envelope,
      mention,
      continuing ? (this.threads.byThread(target)?.lastSeenTs ?? null) : null,
    )
    const scheduleId = slackScheduleId(hook.id, envelope.eventId)
    this.publishDelivery(hook, envelope, chatId)
    const prompt = renderSlackPrompt({
      instruction,
      standing: hook.template,
      context: context.text,
      channel: mention.channel,
      threadTs: mention.threadTs,
    })
    await this.agent.enqueueMessage(chatId, prompt, [], {
      autoContinue: { scheduleId },
      ...(hook.provider && hook.model ? { provider: hook.provider, model: hook.model } : {}),
    })
    await this.threads.markSeen(target, context.seenTs, mention.ts)
    await this.agent.maybeStartNextQueuedMessage(chatId)
  }

  private onBus(envelope: BusEnvelope): void {
    const { chatId } = envelope
    if (chatId === undefined) return
    const onError = (error: Error) => log.error(`[slack] bus handler failed: ${error.message}`)
    if (envelope.subject === CHAT_DELETED_SUBJECT) {
      this.currentScheduleIds.delete(chatId)
      this.tasks.run(() => this.threads.forgetChat(chatId), onError)
      return
    }
    if (envelope.subject === USER_PROMPT_SUBJECT) {
      this.currentScheduleIds.set(chatId, scheduleIdOf(envelope.payload))
      return
    }
    const outcome = TURN_SUBJECTS.get(envelope.subject)
    if (outcome === undefined) return
    const expected = this.currentScheduleIds.get(chatId)
    if (expected === null) return
    this.tasks.run(() => this.lane(`chat:${chatId}`, () => this.respond(chatId, outcome, envelope.payload, expected)), onError)
  }

  private textFor(outcome: TurnOutcome, reply: string | null, payload: JsonValue): string {
    if (outcome === "failed") return failureText(payload)
    if (outcome === "cancelled") return "Cancelled in Kanna."
    return reply ?? ""
  }

  private turnFor(entries: readonly TranscriptEntry[], hookId: string, expected: string | undefined): SlackTurnReply | null {
    if (expected === undefined) return finalReplyAfterSlackPrompt(entries, hookId)
    return isSlackScheduleFor(hookId, expected) ? replyForSlackSchedule(entries, expected) : null
  }

  private async respond(chatId: string, outcome: TurnOutcome, payload: JsonValue, expected: string | undefined): Promise<void> {
    const binding = this.threads.byChat(chatId)
    if (!binding) return
    const entries = this.store.getMessages(chatId)
    const turn = this.turnFor(entries, binding.hookId, expected)
    if (!turn || turn.scheduleId === binding.repliedScheduleId) return
    const hook = this.registry.resolve(binding.hookId)
    const credentials = hook ? slackCredentialsOf(hook) : null
    if (!credentials) return
    const posted = await this.postAll(credentials.botToken, binding.channel, binding.threadTs, this.textFor(outcome, turn.text, payload))
    if (posted) await this.threads.markReplied(chatId, turn.scheduleId)
    await this.react(credentials.botToken, binding.channel, binding.mentionTs, WORKING_REACTION, true)
    const done = posted && outcome === "finished" ? "white_check_mark" : "x"
    await this.react(credentials.botToken, binding.channel, binding.mentionTs, done)
  }

  private async postAll(token: string, channel: string, threadTs: string, text: string): Promise<boolean> {
    for (const markdown of splitSlackReply(text)) {
      const result = await this.api.postMessage(token, { channel, threadTs, markdown })
      if (!result.ok) {
        log.warn(`[slack] could not post the reply: ${result.error}`)
        return false
      }
    }
    return true
  }
}
