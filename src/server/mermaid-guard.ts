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
import { formatMermaidCorrection, type MermaidFailure } from "../shared/mermaid-report"
import { validateMermaidFences } from "../shared/mermaid-validate"
import type { MermaidParsePort } from "../shared/mermaid-validation"

/** What the client's deterministic repair would do to a rejected source. */
export interface MermaidRepairOutcome {
  source: string
  repaired: boolean
}

export interface MermaidGuardEnqueueOptions {
  autoContinue?: { scheduleId: string }
}

export interface MermaidGuardDeps {
  enabled: boolean
  parse: MermaidParsePort
  repair: (source: string) => MermaidRepairOutcome
  /** True while a user message waits — their turn outranks this housekeeping. */
  hasQueuedMessage: (chatId: string) => boolean
  enqueueMessage: (
    chatId: string,
    content: string,
    options?: MermaidGuardEnqueueOptions,
  ) => Promise<void>
}

export interface MermaidGuard {
  /** Inspect one turn's assistant text. Never throws. */
  check: (chatId: string, assistantText: readonly string[]) => Promise<void>
}

/**
 * Diagrams remembered per chat. Small on purpose: it only has to outlive the
 * one correction turn, and forgetting early costs at most one extra ask.
 */
const RETRY_MEMORY_PER_CHAT = 32

function remember(seen: Set<string>, source: string): void {
  seen.add(source)
  while (seen.size > RETRY_MEMORY_PER_CHAT) {
    const oldest = seen.values().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
}

export function createMermaidGuard(deps: MermaidGuardDeps): MermaidGuard {
  const askedByChat = new Map<string, Set<string>>()

  async function collectFailures(text: string, asked: Set<string>): Promise<MermaidFailure[]> {
    const failures: MermaidFailure[] = []
    for (const { fence, result } of await validateMermaidFences(deps.parse, text)) {
      if (result.ok) continue
      if (asked.has(fence.source)) continue

      const repair = deps.repair(fence.source)
      if (repair.repaired && (await deps.parse(repair.source)).ok) continue

      remember(asked, fence.source)
      failures.push({ startLine: fence.startLine, defect: result.defect })
    }
    return failures
  }

  return {
    check: async (chatId, assistantText) => {
      if (!deps.enabled) return
      if (deps.hasQueuedMessage(chatId)) return

      try {
        const asked = askedByChat.get(chatId) ?? new Set<string>()
        askedByChat.set(chatId, asked)

        const failures: MermaidFailure[] = []
        for (const text of assistantText) {
          failures.push(...(await collectFailures(text, asked)))
        }
        if (failures.length === 0) return

        log.info("[kanna/mermaid] asking the model to fix its diagram", {
          chatId,
          diagrams: failures.length,
        })
        await deps.enqueueMessage(chatId, formatMermaidCorrection(failures), {
          autoContinue: { scheduleId: `mermaid-fix-${String(failures.length)}` },
        })
      } catch (error) {
        // A diagram that renders is cosmetic; a turn that dies is not.
        log.warn("[kanna/mermaid] guard failed", { chatId, message: toError(error).message })
      }
    },
  }
}
