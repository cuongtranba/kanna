/**
 * Boot recovery for queued messages that outlived the process that dequeued
 * them.
 *
 * A queued message is a chat's durable "start this once idle" trigger, but
 * nothing on boot ever consumed one — the queue was drained only by live
 * events (a turn finishing, an auto-continue firing). A message queued when
 * the process died therefore sat forever, invisible.
 *
 * That is survivable for a human-typed message (the user retypes it) and
 * fatal for an autonomous loop, whose wake IS the queued message: the loop
 * stayed armed, its only trigger was gone, and it stalled silently until a
 * human noticed. Paired with dequeue-on-commit in `dequeueAndStartQueuedMessage`
 * — which keeps the message queued until its turn is durably recorded — this
 * closes the window. See adr-20260813-queued-message-dequeue-on-commit.
 *
 * Side-effect seal: no direct IO. Every operation is injected.
 */

import { log } from "../shared/log"

export interface QueuedMessageRecoveryDeps {
  listChatsWithQueuedMessages(): string[]
  maybeStartNextQueuedMessage(chatId: string, options?: { replay?: boolean }): Promise<boolean>
}

/**
 * Drain every chat still holding a queued message. Returns the chats whose
 * turn actually started, oldest chat first.
 *
 * Runs sequentially: each drain spawns a provider session, and boot is
 * already the heaviest moment in the process's life. A chat that refuses to
 * start is logged and skipped — recovery is best-effort and must never keep
 * the server from finishing boot.
 */
export async function recoverQueuedMessages(
  deps: QueuedMessageRecoveryDeps,
): Promise<string[]> {
  const recovered: string[] = []
  for (const chatId of deps.listChatsWithQueuedMessages()) {
    try {
      if (await deps.maybeStartNextQueuedMessage(chatId, { replay: true })) recovered.push(chatId)
    } catch (error) {
      log.warn("[kanna] queued-message recovery failed", { chatId, error: String(error) })
    }
  }
  return recovered
}
