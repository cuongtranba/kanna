import { errorMessage } from "../../../shared/errors"
import { log } from "../../../shared/log"
import { createSerialQueue } from "../../serial-lane"

export const SLACK_THREAD_CAP = 1000

export interface SlackThreadBinding {
  key: string
  hookId: string
  teamId: string
  channel: string
  threadTs: string
  chatId: string
  lastSeenTs: string
  mentionTs: string
  repliedScheduleId?: string
  updatedAt: number
}

export type SlackThreadTarget = Pick<SlackThreadBinding, "hookId" | "teamId" | "channel" | "threadTs">

export interface SlackThreadStorePort {
  load(): Promise<SlackThreadBinding[]>
  save(bindings: readonly SlackThreadBinding[]): Promise<void>
}

export function slackThreadKey(target: SlackThreadTarget): string {
  return `${target.hookId}:${target.teamId}:${target.channel}:${target.threadTs}`
}

function isNewer(candidate: string, current: string): boolean {
  return Number(candidate) > Number(current)
}

export class SlackThreadRegistry {
  private readonly bindings = new Map<string, SlackThreadBinding>()
  private readonly writes = createSerialQueue()

  constructor(
    private readonly store: SlackThreadStorePort,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    this.bindings.clear()
    for (const binding of await this.store.load()) this.bindings.set(binding.key, binding)
  }

  byThread(target: SlackThreadTarget): SlackThreadBinding | null {
    const binding = this.bindings.get(slackThreadKey(target))
    return binding ? { ...binding } : null
  }

  byChat(chatId: string): SlackThreadBinding | null {
    for (const binding of this.bindings.values()) if (binding.chatId === chatId) return { ...binding }
    return null
  }

  async bind(target: SlackThreadTarget, chatId: string): Promise<void> {
    const key = slackThreadKey(target)
    this.bindings.set(key, { ...target, key, chatId, lastSeenTs: "0", mentionTs: "", updatedAt: this.now() })
    this.evictOverflow()
    await this.persist()
  }

  async markSeen(target: SlackThreadTarget, seenTs: string, mentionTs: string): Promise<void> {
    const binding = this.bindings.get(slackThreadKey(target))
    if (!binding) return
    const lastSeenTs = isNewer(seenTs, binding.lastSeenTs) ? seenTs : binding.lastSeenTs
    this.bindings.set(binding.key, { ...binding, lastSeenTs, mentionTs, updatedAt: this.now() })
    await this.persist()
  }

  async markReplied(chatId: string, scheduleId: string): Promise<void> {
    const binding = this.byChat(chatId)
    if (!binding) return
    this.bindings.set(binding.key, { ...binding, repliedScheduleId: scheduleId, updatedAt: this.now() })
    await this.persist()
  }

  async forgetChat(chatId: string): Promise<void> {
    const binding = this.byChat(chatId)
    if (!binding) return
    this.bindings.delete(binding.key)
    await this.persist()
  }

  private evictOverflow(): void {
    if (this.bindings.size <= SLACK_THREAD_CAP) return
    const oldestFirst = [...this.bindings.values()].sort((a, b) => a.updatedAt - b.updatedAt)
    for (const stale of oldestFirst.slice(0, this.bindings.size - SLACK_THREAD_CAP)) this.bindings.delete(stale.key)
  }

  private persist(): Promise<void> {
    return this.writes.run(() => this.store.save([...this.bindings.values()])).catch((error: Error) => {
      log.warn(`[slack] could not persist thread bindings: ${errorMessage(error)}`)
    })
  }
}
