/**
 * The model half of `/cron` validation, mirroring the mermaid gate.
 *
 * `/cron` always intercepts and never starts a turn, so a line the parser
 * rejects used to be a dead end: the user got a message about a line nothing
 * recorded, and the model was never involved. Chat 39b0d210 is what that costs
 * — three failures in 34 seconds, no suggestion on any of them, then the user
 * gave up.
 *
 * So when Kanna cannot fix the line itself, it hands it to the model, which
 * either repairs and arms it (`arm_cron`) or asks the user what they meant.
 *
 * Four bounds, each load-bearing:
 *
 * 1. **A deterministic suggestion wins.** The error card already renders a
 *    copy-and-send fix; a turn spent re-deriving it would buy nothing. This is
 *    the analog of the mermaid guard standing down on a repairable diagram.
 * 2. **Arm-shaped failures only.** `/cron remove badid` is a typo with one
 *    right answer, not an intent to interpret.
 * 3. **One ask per line.** A model that cannot repair something must not be
 *    asked about it every time the user retries it.
 * 4. **It never fails the caller.** An unarmed cron is recoverable by typing
 *    the command again; an exception thrown into the send path is not.
 */

import { log } from "../../shared/log"
import { toError } from "../../shared/errors"
import { formatCronRepairRequest } from "../../shared/cron/repair-report"
import type { CronParseError, CronParsePart } from "../../shared/cron/types"

export interface CronRepairEnqueueOptions {
  autoContinue?: { scheduleId: string }
}

export interface CronRepairDeps {
  enabled: boolean
  /** True while a user message waits — their turn outranks this repair. */
  hasQueuedMessage: (chatId: string) => boolean
  enqueueMessage: (
    chatId: string,
    content: string,
    options?: CronRepairEnqueueOptions,
  ) => Promise<void>
  /**
   * Start the queued repair prompt. The mermaid guard needs no equivalent: it
   * runs at a turn boundary where the drain follows anyway, whereas a `/cron`
   * line starts no turn at all, so nothing would ever pick this up.
   */
  drainQueue: (chatId: string) => Promise<void>
}

export interface CronRepair {
  /** Offer a failed `/cron` line to the model. Never throws. */
  offer: (chatId: string, error: CronParseError) => Promise<void>
}

/**
 * Parts that describe an arm the user meant but mistyped. `subcommand` covers
 * `/cron list extra` and the multiline guard — shape errors with a mechanical
 * answer and no schedule to interpret.
 */
const REPAIRABLE_PARTS: readonly CronParsePart[] = [
  "instruction",
  "mode",
  "schedule",
  "schedule_field",
]

/**
 * Lines remembered per chat. Small on purpose: it only has to outlive the one
 * repair turn, and forgetting early costs at most one extra ask.
 */
const RETRY_MEMORY_PER_CHAT = 32

function remember(seen: Set<string>, input: string): void {
  seen.add(input)
  while (seen.size > RETRY_MEMORY_PER_CHAT) {
    const oldest = seen.values().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
}

export function createCronRepair(deps: CronRepairDeps): CronRepair {
  const askedByChat = new Map<string, Set<string>>()

  return {
    offer: async (chatId, error) => {
      if (!deps.enabled) return
      if (error.suggestion !== undefined) return
      if (!REPAIRABLE_PARTS.includes(error.part)) return
      if (deps.hasQueuedMessage(chatId)) return

      const asked = askedByChat.get(chatId) ?? new Set<string>()
      askedByChat.set(chatId, asked)
      if (asked.has(error.input)) return
      remember(asked, error.input)

      try {
        log.info("[kanna/cron] asking the model to repair a /cron line", {
          chatId,
          part: error.part,
        })
        await deps.enqueueMessage(chatId, formatCronRepairRequest(error), {
          autoContinue: { scheduleId: `cron-repair-${error.part}` },
        })
        await deps.drainQueue(chatId)
      } catch (repairError) {
        log.warn("[kanna/cron] repair offer failed", {
          chatId,
          message: toError(repairError).message,
        })
      }
    },
  }
}
