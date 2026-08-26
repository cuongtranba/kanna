/**
 * The backstop half of the mermaid validation gate.
 *
 * `validate_mermaid` lets the model check a diagram before it emits one, which
 * costs no extra turn — but it is prompt-enforced, and a skipped tool call is
 * exactly the failure mode this gate exists to close. So at the end of every
 * successful turn the server reads back what the model actually wrote and asks
 * it to fix anything that will not render.
 *
 * Two things bound the cost, and both are load-bearing:
 *
 * 1. **It fires only when the reader would see an error.** The client repairs
 *    some spellings (`-.x` → `-.-x`) and renders the diagram with an honest
 *    correction banner. Those already produced a diagram; a turn spent on them
 *    would buy nothing.
 * 2. **A given diagram is asked about exactly once.** A model that cannot fix
 *    its own diagram would otherwise be asked forever, one turn at a time.
 *
 * No `/clear` — unlike the subagent-completion delivery this borrows its
 * enqueue shape from, the model needs the diagram still in context to fix it.
 */

import { log } from "../shared/log"
import { toError } from "../shared/errors"
import { formatMermaidCorrection } from "../shared/mermaid-report"
import { validateMermaidFences } from "../shared/mermaid-validate"
import type { MermaidParsePort } from "../shared/mermaid-validation"
import type { ModelEscalation } from "./model-escalation"

/** What the client's deterministic repair would do to a rejected source. */
export interface MermaidRepairOutcome {
  source: string
  repaired: boolean
}

export interface MermaidGuardDeps {
  escalation: ModelEscalation
  parse: MermaidParsePort
  repair: (source: string) => MermaidRepairOutcome
}

export interface MermaidGuard {
  /** Inspect one turn's assistant text. Never throws. */
  check: (chatId: string, assistantText: readonly string[]) => Promise<void>
}

export function createMermaidGuard(deps: MermaidGuardDeps): MermaidGuard {
  return {
    check: async (chatId, assistantText) => {
      try {
        for (const text of assistantText) {
          for (const { fence, result } of await validateMermaidFences(deps.parse, text)) {
            if (result.ok) continue
            const repair = deps.repair(fence.source)
            if (repair.repaired && (await deps.parse(repair.source)).ok) continue
            await deps.escalation.offer(
              chatId,
              fence.source,
              formatMermaidCorrection([{ startLine: fence.startLine, defect: result.defect }]),
              `mermaid-fix-${String(fence.startLine)}`,
            )
          }
        }
      } catch (error) {
        log.warn("[kanna/mermaid] guard failed", { chatId, message: toError(error).message })
      }
    },
  }
}
