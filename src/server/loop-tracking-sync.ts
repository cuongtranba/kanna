/**
 * Reconcile which tracking file each chat's Progress panel is watching against
 * the armed-loop read model.
 *
 * One total, idempotent function rather than a register/unregister pair at
 * every lifecycle site: callers only have to say "something loop-ish happened
 * on this chat", so arm, `stop_loop`, user takeover, chat delete and the
 * repeated-failure disarm all route through the same derivation.
 */

import type { AutoContinueEvent } from "./auto-continue/events"
import { deriveLoopState } from "./auto-continue/read-model"
import { confinePathToDir } from "./input-validation"
import type { LoopTrackingRegistry } from "./loop-tracking-registry"

export interface LoopTrackingSyncDeps {
  getAutoContinueEvents: (chatId: string) => readonly AutoContinueEvent[]
  registry: Pick<LoopTrackingRegistry, "register" | "unregister">
}

export function syncLoopTracking(deps: LoopTrackingSyncDeps, chatId: string): void {
  const loop = deriveLoopState(deps.getAutoContinueEvents(chatId), chatId)
  if (!loop?.workdirAbs || !loop.trackingFileRel) {
    deps.registry.unregister(chatId)
    return
  }
  const confined = confinePathToDir(loop.trackingFileRel, loop.workdirAbs, "tracking file")
  if ("error" in confined) {
    deps.registry.unregister(chatId)
    return
  }
  deps.registry.register(chatId, confined.abs)
}

/**
 * Boot replay: an armed loop outlives the process that armed it, so the watch
 * has to be re-derived from the event log before the first chat snapshot goes
 * out.
 */
export function rehydrateLoopTracking(
  deps: LoopTrackingSyncDeps,
  chatIds: readonly string[],
): void {
  for (const chatId of chatIds) syncLoopTracking(deps, chatId)
}
