import { toError } from "../../shared/errors"
import { extractKannaUiFences, formatGenUIIssues, parseGenUISpec, type DatasetDecl, type GenUIIssue } from "../../shared/genui"
import { contentHash } from "../../shared/genui/hash"
import { log } from "../../shared/log"
import { VALIDATE_UI_TOOL_NAME } from "../../shared/tools"
import type { ModelEscalation } from "../model-escalation"
import { addCounter, GENUI_SPEC_CHECKED } from "../observability"

export type DatasetResolvabilityCheck = (chatId: string, decl: DatasetDecl) => Promise<string | null>

export interface GenUISpecReview {
  issues: GenUIIssue[]
}

export async function reviewGenUISpec(
  source: string,
  checkDataset: (decl: DatasetDecl) => Promise<string | null>,
): Promise<GenUISpecReview> {
  const parsed = parseGenUISpec(source)
  if (!parsed.ok) return { issues: parsed.issues }
  const issues: GenUIIssue[] = []
  for (const [id, decl] of Object.entries(parsed.spec.datasets ?? {})) {
    const problem = await checkDataset(decl)
    if (problem) issues.push({ path: `datasets.${id}`, message: problem })
  }
  return { issues }
}

export function formatGenUICorrection(startLine: number, issues: readonly GenUIIssue[], canValidate: boolean): string {
  return [
    `The \`\`\`kanna-ui view that starts on line ${startLine} of your last reply cannot render:`,
    "",
    formatGenUIIssues(issues),
    "",
    canValidate
      ? `Fix the spec and post the corrected view. Check it with \`${VALIDATE_UI_TOOL_NAME}\` before you send it.`
      : "Fix the spec and post the corrected view.",
  ].join("\n")
}

export interface GenUIGuard {
  check: (chatId: string, assistantText: readonly string[]) => Promise<void>
}

export function createGenUIGuard(escalation: ModelEscalation, checkDataset: DatasetResolvabilityCheck, canValidate: boolean): GenUIGuard {
  return {
    check: async (chatId, assistantText) => {
      try {
        for (const text of assistantText) {
          for (const fence of extractKannaUiFences(text)) {
            if (!fence.closed) continue
            const review = await reviewGenUISpec(fence.source, (decl) => checkDataset(chatId, decl))
            addCounter(GENUI_SPEC_CHECKED, 1, { result: review.issues.length === 0 ? "valid" : "rejected" })
            if (review.issues.length === 0) continue
            await escalation.offer(
              chatId,
              contentHash(fence.source),
              formatGenUICorrection(fence.startLine, review.issues, canValidate),
              `genui-fix-${String(fence.startLine)}`,
            )
          }
        }
      } catch (error) {
        log.warn("[kanna/genui] guard failed", { chatId, message: toError(error).message })
      }
    },
  }
}
