import { chatStatusIndicator, type ChatDotTone } from "../chatStatusIndicator"
import { statusLabel } from "../statusLabel"
import type { ChatActivity, KannaStatus } from "../../../shared/types"

export interface CardChatFacts {
  status: KannaStatus
  unread: boolean
  stateEnteredAt?: number
  activity: ChatActivity
}

export type WorkClock =
  | { kind: "elapsed"; since: number }
  | { kind: "countdown"; until: number }

export interface CardWorkSignal {
  chatId: string
  tone: ChatDotTone | null
  label: string
  linkedCount: number
  clock: WorkClock | null
}

type WorkRow = Pick<CardWorkSignal, "tone" | "label" | "clock">

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`
}

function cronRow(cron: NonNullable<ChatActivity["cron"]>): WorkRow {
  if (cron.nextFireAt === null) return { tone: "muted", label: "Scheduled", clock: null }
  return { tone: "muted", label: "Runs in", clock: { kind: "countdown", until: cron.nextFireAt } }
}

function workRow(chat: CardChatFacts): WorkRow | null {
  const { activity } = chat
  const session = chatStatusIndicator(chat)
  const elapsed: WorkClock | null =
    chat.stateEnteredAt === undefined ? null : { kind: "elapsed", since: chat.stateEnteredAt }

  if (session?.tone === "destructive") return { tone: "destructive", label: session.label, clock: null }
  if (activity.lastRunFailure) {
    const { code } = activity.lastRunFailure
    return { tone: "destructive", label: code === null ? "Agent failed" : `Agent failed — ${code}`, clock: null }
  }
  if (session?.tone === "info" || activity.awaitingAnswer) {
    return { tone: "info", label: session?.label ?? statusLabel("waiting_for_user"), clock: elapsed }
  }
  if (activity.workflow) {
    const { name, agentCount } = activity.workflow
    return { tone: "warning", label: `${name ?? "Workflow"} · ${plural(agentCount, "agent")}`, clock: elapsed }
  }
  if (activity.loop) {
    const { done, total } = activity.loop
    return { tone: "warning", label: `Loop · ${String(done)}/${String(total)}`, clock: elapsed }
  }
  if (activity.agents > 0) return { tone: "warning", label: plural(activity.agents, "agent"), clock: elapsed }
  if (session?.tone === "warning") return { tone: "warning", label: session.label, clock: elapsed }
  if (activity.backgroundTasks > 0) {
    return { tone: "warning", label: plural(activity.backgroundTasks, "background task"), clock: elapsed }
  }
  if (activity.cron && !activity.cron.paused) return cronRow(activity.cron)
  if (session) return { tone: session.tone, label: session.label, clock: null }
  return null
}

export function cardWorkSignal(
  chatIds: readonly string[],
  statuses: Readonly<Record<string, CardChatFacts>>,
): CardWorkSignal | null {
  const known = chatIds.flatMap((chatId) => {
    const chat = statuses[chatId]
    return chat ? [{ chatId, chat }] : []
  })
  if (known.length === 0) return null

  for (const { chatId, chat } of known) {
    const row = workRow(chat)
    if (row) return { chatId, ...row, linkedCount: known.length }
  }

  const first = known[0]
  if (!first) return null
  return {
    chatId: first.chatId,
    tone: null,
    label: plural(known.length, "chat"),
    linkedCount: known.length,
    clock: null,
  }
}
