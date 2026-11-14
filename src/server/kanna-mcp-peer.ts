import { errorMessage } from "../shared/errors"
import {
  LIST_PEER_CHATS_DESCRIPTION,
  SEND_CHAT_MESSAGE_DESCRIPTION,
  WAIT_FOR_CHAT_MESSAGE_DESCRIPTION,
  listPeerChatsInputShape,
  sendChatMessageInputShape,
  waitForChatMessageInputShape,
} from "../shared/peer-messaging/tool-specs.schema"
import { fail, ok, type KannaToolFactory, type ToolResult } from "./kanna-mcp-tool"
import { LIST_PEER_CHATS_TOOL, SEND_CHAT_MESSAGE_TOOL, WAIT_FOR_CHAT_MESSAGE_TOOL } from "../shared/peer-messaging/tool-names"
import type { PeerMessenger } from "./peer-messaging/peer-messenger"
import { listPeerChats, sendChatMessage, waitForChatMessage, type PeerSubagent, type PeerToolResult } from "./peer-messaging/peer-tools"
import type { KannaMcpDelegationContext } from "./kanna-mcp"

function toToolResult(result: PeerToolResult): ToolResult {
  return result.isError ? fail(result.text) : ok(result.text)
}

type PeerDelegationContext = Pick<KannaMcpDelegationContext, "depth" | "parentRunId" | "parentSubagentName">

function callerOf(context: PeerDelegationContext | undefined): { subagent: PeerSubagent | undefined } | null {
  if (!context || context.depth === 0) return { subagent: undefined }
  if (context.parentRunId === null || context.parentSubagentName === undefined) return null
  return { subagent: { runId: context.parentRunId, name: context.parentSubagentName } }
}

export function buildPeerToolList<TTool>(
  messenger: PeerMessenger | undefined,
  chatId: string | null,
  context: PeerDelegationContext | undefined,
  tool: KannaToolFactory<TTool>,
): TTool[] {
  const caller = callerOf(context)
  if (!messenger || !chatId || caller === null) return []
  const { subagent } = caller

  return [
    tool(LIST_PEER_CHATS_TOOL, LIST_PEER_CHATS_DESCRIPTION, listPeerChatsInputShape, async () =>
      toToolResult(listPeerChats(messenger, chatId)),
    ),
    tool(SEND_CHAT_MESSAGE_TOOL, SEND_CHAT_MESSAGE_DESCRIPTION, sendChatMessageInputShape, async (input) => {
      try {
        return toToolResult(await sendChatMessage(messenger, chatId, input, subagent))
      } catch (error) {
        return fail(errorMessage(error))
      }
    }),
    tool(WAIT_FOR_CHAT_MESSAGE_TOOL, WAIT_FOR_CHAT_MESSAGE_DESCRIPTION, waitForChatMessageInputShape, async (input) => {
      try {
        return toToolResult(await waitForChatMessage(messenger, chatId, input, subagent))
      } catch (error) {
        return fail(errorMessage(error))
      }
    }),
  ]
}
