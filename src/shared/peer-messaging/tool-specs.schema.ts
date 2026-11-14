import { z } from "zod"
import { PEER_MESSAGE_MAX_CHARS, PEER_WAIT_DEFAULT_SECONDS, PEER_WAIT_MAX_SECONDS } from "./limits"

export const LIST_PEER_CHATS_DESCRIPTION =
  "List the other chats on this Kanna server, in every project, that you can message. "
  + "Each row has the chat id (use it as `to` in send_chat_message), its title, project, provider and status "
  + "(idle, working or waiting_for_user). accepts is false when that chat refuses messages from other chats."

export const SEND_CHAT_MESSAGE_DESCRIPTION =
  "Send a message to an agent working in another Kanna chat. `to` is the target chat id from list_peer_chats (titles can repeat, so never address by title). "
  + "The message is delivered automatically: it starts a turn at once if that chat is idle. If that chat is busy, its agent reads the message at its next step, "
  + "or when its current turn ends if no step remains; status says which (delivered, injected or queued). "
  + "It arrives labelled as coming from you, not from the user. Replies come back the same way, as a message into this chat. "
  + "Set `run_id` to address one running subagent of the target chat instead of the chat itself (a received message names the run to answer). "
  + "Set `reply_to` to the message_id you are answering. "
  + `Set notify_when_idle to be told once when the target chat finishes and goes idle (the subscription is lost if the server restarts and expires after 12 hours). Send message, notify_when_idle, or both. message is at most ${String(PEER_MESSAGE_MAX_CHARS)} characters. `
  + "summary is an optional short label for your own transcript; it is not sent."

export const WAIT_FOR_CHAT_MESSAGE_DESCRIPTION =
  "Wait during your own turn for the next message from another Kanna chat, and return it. "
  + "Set `from` to wait for one chat only. "
  + `Returns the message text, or a timeout note after timeout_seconds (default ${String(PEER_WAIT_DEFAULT_SECONDS)}, at most ${String(PEER_WAIT_MAX_SECONDS)}). `
  + "If a message is already pending for you, this returns at once with a note: that message reaches you as soon as this tool returns, so you do not need to wait for it."

export const listPeerChatsInputShape = {}

export const sendChatMessageInputShape = {
  to: z.string().describe("The chat id of the target chat, from list_peer_chats"),
  message: z.string().optional().describe("What to tell the other chat's agent. Be self-contained: it cannot see your conversation"),
  summary: z.string().optional().describe("Short label for your own transcript; not sent"),
  notify_when_idle: z.boolean().optional().describe("Notify this chat once when the target chat next becomes idle"),
  run_id: z.string().optional().describe("Deliver to this running subagent run of the target chat instead of the chat's main agent"),
  reply_to: z.string().optional().describe("The message_id of the message you are answering"),
}

export const sendChatMessageInputSchema = z.object(sendChatMessageInputShape)

export type SendChatMessageInput = z.output<typeof sendChatMessageInputSchema>

export const waitForChatMessageInputShape = {
  from: z.string().optional().describe("Only wait for a message from this chat id"),
  timeout_seconds: z.number().optional().describe(`How long to wait, in seconds (default ${String(PEER_WAIT_DEFAULT_SECONDS)}, at most ${String(PEER_WAIT_MAX_SECONDS)})`),
}

export const waitForChatMessageInputSchema = z.object(waitForChatMessageInputShape)

export type WaitForChatMessageInput = z.output<typeof waitForChatMessageInputSchema>
