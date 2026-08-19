import type { ChatDotTone } from "../chatStatusIndicator"
import type { ChatActivity, KannaStatus } from "../../../shared/types"
import { formatCompactDuration } from "../formatDuration"

/**
 * What a card says about the work on it.
 *
 * It used to delegate to `chatStatusIndicator` — the sidebar's table — which
 * knows only a chat's turn status. A card's question is different: not "is this
 * chat running" but "what KIND of work is on this card", and a board is read at
 * a glance across two hundred rows. So this owns an ordered table of its own,
 * over `ChatActivity` as well as the status.
 *
 * `chatStatusIndicator` is deliberately untouched: the sidebar, the pane tab,
 * and the drawer's linked-chat list share its parity contract
 * (adr-20260809-tab-status-indicator-parity), and widening it to satisfy the
 * board would have dragged the loop and the cron into three other surfaces.
 */

/** The live facts a card reads. A structural subset of `SidebarChatRow`. */
export interface CardChatFacts {
  status: KannaStatus
  unread: boolean
  stateEnteredAt?: number
  activity: ChatActivity
}

export interface CardWorkSignal {
  /** The chat the row is about — the newest one with something to say. */
  chatId: string
  /** Null when every linked chat is quiet: the row is then a count, not a state. */
  tone: ChatDotTone | null
  label: string
  linkedCount: number
  /**
   * When the chat entered its current state, for a live elapsed stamp — null
   * unless the row names work that is still going. A ticker beside "failed"
   * would imply it has not stopped, and a countdown is not an elapsed time.
   */
  liveSince: number | null
}

/** One row of the precedence table. */
interface WorkRow {
  tone: ChatDotTone
  label: string
  /** Whether this row's work is still in flight, and so earns the ticker. */
  ticks: boolean
}

function counted(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`
}

/**
 * Scheduled work is not running work, so this row is muted rather than amber:
 * amber states *attention available*, and nothing is available yet.
 */
function cronLabel(nextFireAt: number | null, nowMs: number): string {
  if (nextFireAt === null) return "scheduled"
  if (nextFireAt <= nowMs) return "due now"
  return `runs in ${formatCompactDuration(nextFireAt - nowMs)}`
}

/**
 * The precedence table, first match wins. Ordered by what a reader most needs
 * to know, and within that by how much the row SAYS: a loop outranks a bare
 * agent count because an agent under a loop is one chunk of a plan, and
 * "loop · 5/8" tells the reader where that plan has got to while "1 agent"
 * tells them only that something is on.
 *
 * Returns null for a chat with nothing to say — the caller then falls through
 * to the count (row 10).
 */
function workRow(chat: CardChatFacts, nowMs: number): WorkRow | null {
  const { activity } = chat

  // 1 — the session or its last run failed. No ticker: failure is not a duration.
  if (chat.status === "failed" || activity.lastFailure !== null) {
    const reason = activity.lastFailure?.reason.trim() ?? ""
    // Never a dangling em dash: a failure whose reason never reached the read
    // model still reads as a sentence.
    const label = reason.length === 0 ? "agent failed" : `agent failed — ${reason}`
    return { tone: "destructive", label, ticks: false }
  }

  // 2 — the agent is blocked on the reader. The only row that is about them.
  if (activity.awaitingAnswer || chat.status === "waiting_for_user") {
    return { tone: "info", label: "waiting for you", ticks: true }
  }

  // 3 — a workflow names its own shape, so it outranks every count below.
  if (activity.workflow !== null) {
    const name = activity.workflow.name?.trim() ?? ""
    const subject = name.length === 0 ? "workflow" : name
    return {
      tone: "warning",
      label: `${subject} · ${counted(activity.workflow.agentCount, "agent")}`,
      ticks: true,
    }
  }

  // 4 — a loop, for the same reason: 5/8 places the work inside a plan.
  if (activity.loop !== null) {
    return {
      tone: "warning",
      label: `loop · ${String(activity.loop.done)}/${String(activity.loop.total)}`,
      ticks: true,
    }
  }

  // 5 — bare agents: work with no named shape, but still work.
  if (activity.agents > 0) {
    return { tone: "warning", label: counted(activity.agents, "agent"), ticks: true }
  }

  // 6 — the session itself. Below the agents it spawned, which say more.
  if (chat.status === "running" || chat.status === "starting") {
    return { tone: "warning", label: "running", ticks: true }
  }

  // 7 — background tasks outlive the turn that launched them.
  if (activity.backgroundTasks > 0) {
    return {
      tone: "warning",
      label: counted(activity.backgroundTasks, "background task"),
      ticks: true,
    }
  }

  // 8 — a job waiting to fire. Muted, and no ticker on a countdown.
  if (activity.cron !== null && !activity.cron.paused) {
    return { tone: "muted", label: cronLabel(activity.cron.nextFireAt, nowMs), ticks: false }
  }

  // 9 — output nobody has read. The last thing that survives a quiet chat.
  if (chat.unread) return { tone: "success", label: "unread", ticks: false }

  return null
}

export function cardWorkSignal(
  chatIds: readonly string[],
  statuses: Readonly<Record<string, CardChatFacts>>,
  nowMs: number,
): CardWorkSignal | null {
  // A link is evidence, not proof — the reaper deletes chats nobody wrote to,
  // so a card can outlive its chat and must not offer to open one that is gone.
  const known = chatIds.flatMap((chatId) => {
    const chat = statuses[chatId]
    return chat ? [{ chatId, chat }] : []
  })
  if (known.length === 0) return null

  for (const { chatId, chat } of known) {
    const row = workRow(chat, nowMs)
    if (!row) continue
    return {
      chatId,
      tone: row.tone,
      label: row.label,
      linkedCount: known.length,
      liveSince: row.ticks ? chat.stateEnteredAt ?? null : null,
    }
  }

  // 10 — every linked chat is quiet. The row is a count, not a state.
  const first = known[0]
  if (!first) return null
  return {
    chatId: first.chatId,
    tone: null,
    label: known.length === 1 ? "1 chat" : `${String(known.length)} chats`,
    linkedCount: known.length,
    liveSince: null,
  }
}
