import { errorMessage } from "../shared/errors"
import {
  LIST_PEER_CHATS_DESCRIPTION,
  SEND_CHAT_MESSAGE_DESCRIPTION,
  listPeerChatsInputShape,
  sendChatMessageInputShape,
} from "../shared/peer-messaging/tool-specs.schema"
import { fail, ok, type KannaToolFactory, type ToolResult } from "./kanna-mcp-tool"
import { LIST_PEER_CHATS_TOOL, SEND_CHAT_MESSAGE_TOOL } from "../shared/peer-messaging/tool-names"
import type { PeerMessenger } from "./peer-messaging/peer-messenger"
import { listPeerChats, sendChatMessage, type PeerToolResult } from "./peer-messaging/peer-tools"

function toToolResult(result: PeerToolResult): ToolResult {
  return result.isError ? fail(result.text) : ok(result.text)
}

export function buildPeerToolList<TTool>(
  messenger: PeerMessenger | undefined,
  chatId: string | null,
  depth: number,
  tool: KannaToolFactory<TTool>,
): TTool[] {
  if (!messenger || !chatId || depth > 0) return []

  return [
    tool(LIST_PEER_CHATS_TOOL, LIST_PEER_CHATS_DESCRIPTION, listPeerChatsInputShape, async () =>
      toToolResult(listPeerChats(messenger, chatId)),
    ),
    tool(SEND_CHAT_MESSAGE_TOOL, SEND_CHAT_MESSAGE_DESCRIPTION, sendChatMessageInputShape, async (input) => {
      try {
        return toToolResult(await sendChatMessage(messenger, chatId, input))
      } catch (error) {
        return fail(errorMessage(error))
      }
    }),
  ]
}
