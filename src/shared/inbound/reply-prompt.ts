import type { JsonValue } from "../json"
import { INBOX_REPLY_MAX_CHARS } from "../inbox/types"
import {
  fenced,
  inboundUntrustedNotice,
  renderHandlerInstruction,
  renderInboundBlock,
  substituteInboundTemplate,
} from "./template"

export interface ReplyPromptInput {
  sourceName: string
  replyHint: string
  latestMessage: JsonValue
  text: string
}

export interface InstructPromptInput extends ReplyPromptInput {
  threadId: string
}

function capped(text: string): string {
  return text.length > INBOX_REPLY_MAX_CHARS ? text.slice(0, INBOX_REPLY_MAX_CHARS) : text
}

function originalMessage(sourceName: string, latestMessage: JsonValue): string {
  return renderInboundBlock(latestMessage, inboundUntrustedNotice(`${sourceName} message`))
}

function hintLine(replyHint: string, latestMessage: JsonValue): string {
  const hint = substituteInboundTemplate(replyHint, latestMessage).trim()
  return hint.length > 0 ? `\n\n${hint}` : ""
}

export function renderReplyPrompt(input: ReplyPromptInput): string {
  return [
    `The user is replying to the message below, received from ${input.sourceName}. Send exactly the reply text through that source's tools, then confirm what you sent.${hintLine(input.replyHint, input.latestMessage)}`,
    `Reply text:\n\n${fenced(capped(input.text), "text")}`,
    originalMessage(input.sourceName, input.latestMessage),
  ].join("\n\n")
}

export function renderInstructPrompt(input: InstructPromptInput): string {
  return [
    `The user has a new instruction for the inbound thread below, received from ${input.sourceName}. Carry it out, do not send anything to the sender, then report again.${hintLine(input.replyHint, input.latestMessage)}`,
    `Instruction:\n\n${fenced(capped(input.text), "text")}`,
    originalMessage(input.sourceName, input.latestMessage),
    renderHandlerInstruction({ threadId: input.threadId, sourceName: input.sourceName, replyHint: "" }),
  ].join("\n\n")
}
