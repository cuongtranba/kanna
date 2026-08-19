import { chatStatusIndicator, type ChatDotTone } from "../chatStatusIndicator"
import { statusLabel } from "../statusLabel"
import type { ChatActivity, KannaStatus } from "../../../shared/types"

/**
 * What a card says about the work running on it.
 *
 * Six kinds of work are keyed by chat id — session, agent, workflow, loop,
 * background task, cron — and a card has room for exactly one line. So this is
 * a precedence table: first match wins, richest signal first. It answers "what
 * is working this issue right now", not "what did the last write leave behind"
 * (the card face used to key on `card.updatedBy.kind`, which is ATTRIBUTION: a
 * card finished an hour ago looked identical to one mid-turn).
 *
 * Session state is not re-classified here. `chatStatusIndicator` — the same
 * table the sidebar row and the pane tab draw from — maps status to tone, and
 * that TONE is what places a session row in the table, so a status added there
 * lands at a severity rather than falling through to a bare chat count.
 *
 * Loop outranks a bare agent count because it names the SHAPE of the work: an
 * agent running under a loop is one chunk of a plan, and `5/8` says more than
 * `1 agent`.
 */

/** The live facts a card reads. A structural subset of `SidebarChatRow`. */
export interface CardChatFacts {
  status: KannaStatus
  unread: boolean
  stateEnteredAt?: number
  activity: ChatActivity
}

/**
 * The live time a row shows, and which direction it runs.
 *
 * One field rather than two nullable timestamps: a row showing both an elapsed
 * ticker and a countdown is not a state that should be expressible. A ticker
 * beside "failed" would imply it has not stopped, and a countdown is not an
 * elapsed time.
 */
export type WorkClock =
  | { kind: "elapsed"; since: number }
  | { kind: "countdown"; until: number }

export interface CardWorkSignal {
  /** The chat the row is about — the newest one with something to say. */
  chatId: string
  /** Null when every linked chat is quiet: the row is then a count, not a state. */
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
  // Muted, never amber: scheduled work is not running work, and amber means
  // attention is available now.
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
  // A link is evidence, not proof — the reaper deletes chats nobody wrote to,
  // so a card can outlive its chat and must not offer to open one that is gone.
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
