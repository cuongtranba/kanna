import { z } from "zod"
import { errorMessage } from "../shared/errors"
import { INBOX_PROPOSAL_REASON_MAX_CHARS } from "../shared/inbox/autonomy"
import { INBOX_DRAFT_MAX_CHARS, INBOX_REPLY_MAX_CHARS, INBOX_SUMMARY_MAX_CHARS, INBOX_VERDICTS } from "../shared/inbox/types"
import type { InboxRegistry } from "./inbox/inbox-registry"
import { fail, ok, type KannaToolFactory } from "./kanna-mcp-tool"

const INBOX_REPORT_DESCRIPTION =
  "Report your verdict on an inbound message thread you were asked to handle. "
  + "verdict is needs_you (the user must act), fyi (worth knowing, no action) or handled (nothing left to do). "
  + `summary is at most ${String(INBOX_SUMMARY_MAX_CHARS)} characters; draft_reply is an optional reply the user can send from the Inbox. `
  + `propose_send is the ONLY way to send a reply to the sender: give the exact text (at most ${String(INBOX_REPLY_MAX_CHARS)} characters), your confidence from 0 to 1 and a short reason. `
  + "Kanna decides what happens next: it may keep the text as a draft, ask the user to approve it, or send it after a short delay. "
  + "Never send anything to the sender any other way, and never use the source's own tools."

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
        verdict: z.enum(INBOX_VERDICTS).describe("needs_you, fyi or handled."),
        summary: z.string().max(INBOX_SUMMARY_MAX_CHARS).describe("What the message says and what you found."),
        draft_reply: z.string().max(INBOX_DRAFT_MAX_CHARS).optional().describe("Optional reply for the user to review."),
        propose_send: z.object({
          text: z.string().max(INBOX_REPLY_MAX_CHARS).describe("The exact reply to send."),
          confidence: z.number().min(0).max(1).describe("How sure you are that this reply is right and safe to send, from 0 to 1."),
          reason: z.string().max(INBOX_PROPOSAL_REASON_MAX_CHARS).describe("Why this reply is appropriate."),
        }).optional().describe("Optional proposal to send a reply. Kanna decides whether it is sent."),
      },
      async (input) => {
        const { thread_id: threadId, verdict, summary, draft_reply: draftReply, propose_send: proposeSend } = input
        try {
          const result = await registry.report(threadId, chatId, verdict, summary, draftReply, proposeSend)
          return result.ok ? ok(`Reported ${verdict} on thread ${threadId}`) : fail(result.error)
        } catch (error) {
          return fail(errorMessage(error))
        }
      },
    ),
  ]
}
