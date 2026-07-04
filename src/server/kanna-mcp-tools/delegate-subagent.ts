import { z } from "zod"
import type { TranscriptEntry } from "../../shared/types"
import type { SubagentOrchestrator } from "../subagent-orchestrator"

const InputSchema = z.object({
  subagent_id: z.string().min(1).describe(
    "Subagent ID from the roster in the system prompt. Match the `id=...` token, not the human name.",
  ),
  prompt: z.string().min(1).describe(
    "Self-contained instructions for the subagent. Distill the relevant chat context, state the goal, list constraints, and end with the concrete deliverable you need back. The subagent does not see your chat history.",
  ),
  keep_alive: z.boolean().optional().describe(
    "Keep the subagent session alive after the first turn for follow-up prompts via send_subagent_message. Claude subagents only.",
  ),
  run_in_background: z.boolean().optional().describe(
    "Launch the subagent without blocking your turn. Returns immediately with {status:'async_launched', run_id}; the subagent's final reply is delivered back to you as a new turn when it finishes. Use for long jobs you don't need to wait on. Mutually exclusive with keep_alive.",
  ),
})

export type DelegateSubagentInput = z.infer<typeof InputSchema>

export interface DelegateSubagentContext {
  chatId: string
  /** Subagent id of the caller when invoked from a subagent's own MCP — null for the main agent. */
  parentSubagentId: string | null
  /** Run id of the caller when invoked from a subagent — null for the main agent. */
  parentRunId: string | null
  /** Ancestor chain (oldest first, excludes the immediate caller). */
  ancestorSubagentIds: string[]
  /** Depth of the spawned run. Main agent → 1, subagent → its depth + 1. */
  depth: number
  /**
   * Resolves to the user message id the current turn is responding to.
   * Returns null when no turn is active — the tool then errors out rather
   * than fabricating a parent.
   */
  getParentUserMessageId: () => string | null
  /** Subagent ids the user @-mentioned in the message that started the turn. Gates manual-trigger subagents. */
  getMentionedSubagentIds: () => string[]
  /**
   * Optional per-entry callback. Each persisted subagent transcript entry
   * (tool_call, tool_result, assistant_text, …) is forwarded here while
   * the run is in flight. Wired by `kanna-mcp.ts` to emit MCP
   * `notifications/progress` so the CLI's transport-error watchdog
   * resets its `armedAt` timer and does not declare the call lost on
   * long-running subagent runs.
   */
  onEntry?: (entry: TranscriptEntry) => void
}

export interface DelegateSubagentTool {
  name: "delegate_subagent"
  schema: typeof InputSchema
  handler: (
    input: DelegateSubagentInput,
    ctx: DelegateSubagentContext,
  ) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>
}

const DESCRIPTION =
  "Hand off focused work to a specialized subagent listed in the system prompt. By default blocks until the subagent finishes and returns its final reply as text. Pass run_in_background:true to launch it without waiting — you get {status:'async_launched', run_id} immediately and the reply arrives as a new turn when it finishes. Brief the subagent like a smart colleague who just walked in: state the goal, what was tried, what to check, any constraints. The subagent cannot see your chat history — distill the context yourself."

export function createDelegateSubagentTool(deps: {
  orchestrator: SubagentOrchestrator
}): DelegateSubagentTool {
  return {
    name: "delegate_subagent",
    schema: InputSchema,
    async handler(input, ctx) {
      const parentUserMessageId = ctx.getParentUserMessageId()
      if (!parentUserMessageId) {
        return {
          content: [{
            type: "text" as const,
            text: "No active turn — delegate_subagent must be called inside a running chat turn.",
          }],
          isError: true,
        }
      }
      const mentionedSubagentIds = ctx.getMentionedSubagentIds()
      if (input.keep_alive && input.run_in_background) {
        return {
          content: [{
            type: "text" as const,
            text: "keep_alive and run_in_background are mutually exclusive — keep_alive holds a warm session for follow-up turns; run_in_background fires the run and delivers the result later. Pick one.",
          }],
          isError: true,
        }
      }
      const outcome = await deps.orchestrator.delegateRun({
        chatId: ctx.chatId,
        parentUserMessageId,
        parentRunId: ctx.parentRunId,
        parentSubagentId: ctx.parentSubagentId,
        ancestorSubagentIds: ctx.ancestorSubagentIds,
        depth: ctx.depth,
        subagentId: input.subagent_id,
        mentionedSubagentIds,
        prompt: input.prompt,
        onEntry: ctx.onEntry,
        keepAlive: input.keep_alive,
        background: input.run_in_background,
      })
      if (outcome.status === "async_launched") {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "async_launched",
              run_id: outcome.runId,
            }),
          }],
        }
      }
      if (outcome.status === "completed") {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "completed",
              run_id: outcome.runId,
              reply: outcome.text,
            }),
          }],
        }
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "failed",
            run_id: outcome.runId,
            error_code: outcome.errorCode,
            error_message: outcome.errorMessage,
          }),
        }],
        isError: true,
      }
    },
  }
}

export const DELEGATE_SUBAGENT_DESCRIPTION = DESCRIPTION
