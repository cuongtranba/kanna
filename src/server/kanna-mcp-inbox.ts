import { z } from "zod"
import { errorMessage } from "../shared/errors"
import { INBOX_DRAFT_MAX_CHARS, INBOX_SUMMARY_MAX_CHARS, isInboxVerdict } from "../shared/inbox/types"
import type { InboxRegistry } from "./inbox/inbox-registry"
import { fail, ok, type KannaToolFactory } from "./kanna-mcp-tool"

const INBOX_REPORT_DESCRIPTION =
  "Report your verdict on an inbound message thread you were asked to handle. "
  + "verdict is needs_you (the user must act), fyi (worth knowing, no action) or handled (nothing left to do). "
  + `summary is at most ${String(INBOX_SUMMARY_MAX_CHARS)} characters; draft_reply is an optional reply the user can send from the Inbox. `
  + "This never sends anything to the sender."

export function buildInboxToolList<TTool>(
  registry: InboxRegistry | undefined,
  chatId: string | null,
  depth: number,
  tool: KannaToolFactory<TTool>,
): TTool[] {
  if (!registry || !chatId || depth > 0) return []

  return [
    tool(
      "inbox_report",
      INBOX_REPORT_DESCRIPTION,
      {
        thread_id: z.string().describe("The thread id named in your instructions."),
        verdict: z.enum(["needs_you", "fyi", "handled"]).describe("needs_you, fyi or handled."),
        summary: z.string().max(INBOX_SUMMARY_MAX_CHARS).describe("What the message says and what you found."),
        draft_reply: z.string().max(INBOX_DRAFT_MAX_CHARS).optional().describe("Optional reply for the user to review."),
      },
      async (input) => {
        const { thread_id: threadId, verdict, summary, draft_reply: draftReply } = input
        if (typeof threadId !== "string" || typeof verdict !== "string" || !isInboxVerdict(verdict) || typeof summary !== "string") {
          return fail("thread_id, verdict and summary are required")
        }
        try {
          const result = await registry.report(threadId, chatId, verdict, summary, typeof draftReply === "string" ? draftReply : undefined)
          return result.ok ? ok(`Reported ${verdict} on thread ${threadId}`) : fail(result.error)
        } catch (error) {
          return fail(errorMessage(error))
        }
      },
    ),
  ]
}
