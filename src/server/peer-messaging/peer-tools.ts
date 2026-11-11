import { z } from "zod"
import { renderJsonSchema } from "../../shared/commands"
import type { JsonValue } from "../../shared/json"
import type { DynamicToolSpec } from "../codex-app-server-protocol"
import type { CodexKannaTools } from "../codex-dynamic-tool-call"
import {
  LIST_PEER_CHATS_DESCRIPTION,
  SEND_CHAT_MESSAGE_DESCRIPTION,
  listPeerChatsInputShape,
  sendChatMessageInputSchema,
  type SendChatMessageInput,
} from "../../shared/peer-messaging/tool-specs.schema"
import { LIST_PEER_CHATS_TOOL, SEND_CHAT_MESSAGE_TOOL } from "../../shared/peer-messaging/tool-names"
import type { PeerMessenger } from "./peer-messenger"

export interface PeerToolResult {
  text: string
  isError: boolean
}

const PEER_TOOL_SPECS: readonly DynamicToolSpec[] = [
  {
    type: "function",
    name: LIST_PEER_CHATS_TOOL,
    description: LIST_PEER_CHATS_DESCRIPTION,
    inputSchema: renderJsonSchema(z.object(listPeerChatsInputShape), "input"),
  },
  {
    type: "function",
    name: SEND_CHAT_MESSAGE_TOOL,
    description: SEND_CHAT_MESSAGE_DESCRIPTION,
    inputSchema: renderJsonSchema(sendChatMessageInputSchema, "input"),
  },
]

export function listPeerChats(messenger: PeerMessenger, chatId: string): PeerToolResult {
  return { text: JSON.stringify({ chats: messenger.listPeers(chatId) }), isError: false }
}

export async function sendChatMessage(
  messenger: PeerMessenger,
  chatId: string,
  input: SendChatMessageInput,
): Promise<PeerToolResult> {
  const result = await messenger.send({
    fromChatId: chatId,
    to: input.to,
    message: input.message,
    notifyWhenIdle: input.notify_when_idle,
  })
  return { text: JSON.stringify(result), isError: !result.ok }
}

async function runPeerTool(
  messenger: PeerMessenger,
  chatId: string,
  tool: string,
  args: JsonValue,
): Promise<PeerToolResult | null> {
  if (tool === LIST_PEER_CHATS_TOOL) return listPeerChats(messenger, chatId)
  if (tool !== SEND_CHAT_MESSAGE_TOOL) return null
  const parsed = sendChatMessageInputSchema.safeParse(args)
  if (!parsed.success) return { text: `Invalid arguments: ${z.prettifyError(parsed.error)}`, isError: true }
  return sendChatMessage(messenger, chatId, parsed.data)
}

export function createCodexKannaTools(messenger: PeerMessenger): CodexKannaTools {
  return { specs: PEER_TOOL_SPECS, call: (chatId, tool, args) => runPeerTool(messenger, chatId, tool, args) }
}
