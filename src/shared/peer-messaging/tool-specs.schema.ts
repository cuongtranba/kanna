import { z } from "zod"
import { PEER_MESSAGE_MAX_CHARS } from "./limits"

export const LIST_PEER_CHATS_DESCRIPTION =
  "List the other chats on this Kanna server, in every project, that you can message. "
  + "Each row has the chat id (use it as `to` in send_chat_message), its title, project, provider and status "
  + "(idle, working or waiting_for_user). accepts is false when that chat refuses messages from other chats."

export const SEND_CHAT_MESSAGE_DESCRIPTION =
  "Send a message to an agent working in another Kanna chat. `to` is the target chat id from list_peer_chats (titles can repeat, so never address by title). "
  + "The message is delivered automatically: it starts a turn at once if that chat is idle, otherwise it waits for the current turn to end. "
  + "It arrives labelled as coming from you, not from the user. Replies come back the same way, as a message into this chat. "
  + `Set notify_when_idle to be told once when the target chat finishes and goes idle (the subscription is lost if the server restarts and expires after 12 hours). Send message, notify_when_idle, or both. message is at most ${String(PEER_MESSAGE_MAX_CHARS)} characters. `
  + "summary is an optional short label for your own transcript; it is not sent."

export const listPeerChatsInputShape = {}

export const sendChatMessageInputShape = {
  to: z.string().describe("The chat id of the target chat, from list_peer_chats"),
  message: z.string().optional().describe("What to tell the other chat's agent. Be self-contained: it cannot see your conversation"),
  summary: z.string().optional().describe("Short label for your own transcript; not sent"),
  notify_when_idle: z.boolean().optional().describe("Notify this chat once when the target chat next becomes idle"),
}

export const sendChatMessageInputSchema = z.object(sendChatMessageInputShape)

export type SendChatMessageInput = z.output<typeof sendChatMessageInputSchema>
