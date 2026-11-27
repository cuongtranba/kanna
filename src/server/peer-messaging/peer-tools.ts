import { z } from "zod"
import { renderJsonSchema } from "../../shared/commands"
import type { JsonValue } from "../../shared/json"
import type { DynamicToolSpec } from "../codex-app-server-protocol"
import type { CodexKannaTools } from "../codex-dynamic-tool-call"
import {
  LIST_PEER_CHATS_DESCRIPTION,
  SEND_CHAT_MESSAGE_DESCRIPTION,
  WAIT_FOR_CHAT_MESSAGE_DESCRIPTION,
  listPeerChatsInputSchema,
  sendChatMessageInputSchema,
  waitForChatMessageInputSchema,
  type ListPeerChatsInput,
  type SendChatMessageInput,
  type WaitForChatMessageInput,
} from "../../shared/peer-messaging/tool-specs.schema"
import { LIST_PEER_CHATS_TOOL, SEND_CHAT_MESSAGE_TOOL, WAIT_FOR_CHAT_MESSAGE_TOOL } from "../../shared/peer-messaging/tool-names"
import type { PeerMessenger } from "./peer-messenger"
import type { McpSkillTools } from "../kanna-mcp-skills"
import { callMcpSkillTool, MCP_SKILL_TOOL_SPECS } from "../mcp-skills/mcp-skill-codex-tools"

export interface PeerSubagent {
  runId: string
  name: string
}

export interface PeerToolResult {
  text: string
  isError: boolean
}

const PEER_TOOL_SPECS: readonly DynamicToolSpec[] = [
  {
    type: "function",
    name: LIST_PEER_CHATS_TOOL,
    description: LIST_PEER_CHATS_DESCRIPTION,
    inputSchema: renderJsonSchema(listPeerChatsInputSchema, "input"),
  },
  {
    type: "function",
    name: SEND_CHAT_MESSAGE_TOOL,
    description: SEND_CHAT_MESSAGE_DESCRIPTION,
    inputSchema: renderJsonSchema(sendChatMessageInputSchema, "input"),
  },
  {
    type: "function",
    name: WAIT_FOR_CHAT_MESSAGE_TOOL,
    description: WAIT_FOR_CHAT_MESSAGE_DESCRIPTION,
    inputSchema: renderJsonSchema(waitForChatMessageInputSchema, "input"),
  },
]

export function listPeerChats(messenger: PeerMessenger, chatId: string, input: ListPeerChatsInput = {}): PeerToolResult {
  return { text: JSON.stringify(messenger.listPeers(chatId, input)), isError: false }
}

export async function sendChatMessage(
  messenger: PeerMessenger,
  chatId: string,
  input: SendChatMessageInput,
  subagent?: PeerSubagent,
): Promise<PeerToolResult> {
  const result = await messenger.send({
    fromChatId: chatId,
    fromRunId: subagent?.runId,
    fromSubagentName: subagent?.name,
    to: input.to,
    message: input.message,
    notifyWhenIdle: input.notify_when_idle,
    runId: input.run_id,
    replyTo: input.reply_to,
  })
  return { text: JSON.stringify(result), isError: !result.ok }
}

export async function waitForChatMessage(
  messenger: PeerMessenger,
  chatId: string,
  input: WaitForChatMessageInput,
  subagent?: PeerSubagent,
): Promise<PeerToolResult> {
  const result = await messenger.waitForMessage({
    chatId,
    runId: subagent?.runId,
    from: input.from,
    timeoutSeconds: input.timeout_seconds,
  })
  return { text: JSON.stringify(result), isError: false }
}

async function runPeerTool(
  messenger: PeerMessenger,
  chatId: string,
  tool: string,
  args: JsonValue,
): Promise<PeerToolResult | null> {
  if (tool === LIST_PEER_CHATS_TOOL) {
    const parsed = listPeerChatsInputSchema.safeParse(args)
    if (!parsed.success) return { text: `Invalid arguments: ${z.prettifyError(parsed.error)}`, isError: true }
    return listPeerChats(messenger, chatId, parsed.data)
  }
  if (tool === SEND_CHAT_MESSAGE_TOOL) {
    const parsed = sendChatMessageInputSchema.safeParse(args)
    if (!parsed.success) return { text: `Invalid arguments: ${z.prettifyError(parsed.error)}`, isError: true }
    return sendChatMessage(messenger, chatId, parsed.data)
  }
  if (tool !== WAIT_FOR_CHAT_MESSAGE_TOOL) return null
  const parsed = waitForChatMessageInputSchema.safeParse(args)
  if (!parsed.success) return { text: `Invalid arguments: ${z.prettifyError(parsed.error)}`, isError: true }
  return waitForChatMessage(messenger, chatId, parsed.data)
}

export function createCodexKannaTools(messenger: PeerMessenger, skills?: McpSkillTools): CodexKannaTools {
  return {
    specs: skills ? [...PEER_TOOL_SPECS, ...MCP_SKILL_TOOL_SPECS] : PEER_TOOL_SPECS,
    call: async (chatId, tool, args) =>
      (await runPeerTool(messenger, chatId, tool, args)) ?? (skills ? await callMcpSkillTool(skills, tool, args) : null),
  }
}
