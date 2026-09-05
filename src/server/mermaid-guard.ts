
import { log } from "../shared/log"
import { toError } from "../shared/errors"
import { formatMermaidCorrection } from "../shared/mermaid-report"
import { validateMermaidFences } from "../shared/mermaid-validate"
import type { MermaidParsePort } from "../shared/mermaid-validation"
import type { ModelEscalation } from "./model-escalation"

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
