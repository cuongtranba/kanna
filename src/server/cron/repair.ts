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

import { formatCronRepairRequest } from "../../shared/cron/repair-report"
import type { CronParseError, CronParsePart } from "../../shared/cron/types"
import type { ModelEscalation } from "../model-escalation"

/**
 * Parts that describe an arm the user meant but mistyped. `subcommand` is
 * deliberately excluded — `/cron list extra`, `/cron remove` with no id, and
 * friends always carry a mechanical `suggestion`, so they never even reach
 * this check (the `error.suggestion !== undefined` guard above catches them
 * first); the exclusion is belt-and-suspenders for a shape that should never
 * arrive here without a fix already attached.
 *
 * `multiline` is repairable: a `/cron` message that spans multiple lines is
 * still arm-shaped (usually a verbose instruction the user wrapped or
 * appended a thought to) with no mechanical way to collapse it into one line
 * — exactly the free-form intent this escalation exists to interpret.
 */
const REPAIRABLE_PARTS: readonly CronParsePart[] = [
  "instruction",
  "mode",
  "schedule",
  "schedule_field",
  "multiline",
]

export interface CronRepairDeps {
  escalation: ModelEscalation
}

export interface CronRepair {
  /** Offer a failed `/cron` line to the model. Never throws. */
  offer: (chatId: string, error: CronParseError) => Promise<void>
}

export function createCronRepair(deps: CronRepairDeps): CronRepair {
  return {
    offer: async (chatId, error) => {
      if (error.suggestion !== undefined) return
      if (!REPAIRABLE_PARTS.includes(error.part)) return
      await deps.escalation.offer(
        chatId,
        error.input,
        formatCronRepairRequest(error),
        `cron-repair-${error.part}`,
      )
    },
  }
}
