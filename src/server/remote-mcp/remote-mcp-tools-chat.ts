import type { ToolRegistrar } from "./remote-mcp-tool-registrar"
import { z } from "zod"
import { AGENT_PROVIDERS } from "../../shared/core-types"
import { jsonValueSchema } from "../../shared/genui/json-schema"
import { isJsonObject } from "../../shared/json"
import { fail } from "../kanna-mcp-tool"
import { acceptedReport, followReply, guardedChatSend, guardedEnqueue } from "./remote-mcp-follow"
import { DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS } from "./remote-mcp-follow-view"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { latestTurnBaseline, type SendCommand } from "./send-and-wait"
import {
  clipText,
  commandResult,
  flattenEntries,
  jsonResult,
  latestModel,
  newestEntryTime,
  pendingToolRequests,
  readChat,
  runCommand,
  toJson,
} from "./remote-mcp-views"

const DEFAULT_ENTRY_LIMIT = 50
const MAX_ENTRY_LIMIT = 500
const QUEUED_PREVIEW_CHARS = 200
const BUSY_STATUSES: ReadonlySet<string> = new Set(["starting", "running"])

const chatIdField = z.string().describe("Id of the chat")

const attachmentSchema = z.object({
  id: z.string().describe("Attachment id returned by upload_attachment"),
  kind: z.enum(["image", "file", "mention"]).describe("Attachment kind"),
  displayName: z.string().describe("File name shown to the model"),
  absolutePath: z.string().describe("Absolute path on the Kanna host"),
  relativePath: z.string().describe("Path relative to the project"),
  contentUrl: z.string().describe("Content URL returned by upload_attachment"),
  mimeType: z.string().describe("MIME type"),
  size: z.number().describe("Size in bytes"),
})

const decisionSchema = z.object({
  kind: z.enum(["allow", "deny", "answer"]).describe("allow or deny the tool call, or answer a question"),
  payload: jsonValueSchema.optional().describe("The answer when kind is answer"),
  reason: z.string().optional().describe("Optional explanation recorded with the decision"),
})

export function registerChatTools(tools: ToolRegistrar, host: RemoteMcpHost): void {
  tools.registerTool(
    "create_chat",
    {
      title: "Create a chat",
      description:
        "Create an empty chat in a project and return its chatId. Rarely needed: send_message with projectId opens a new chat and sends the first prompt in one call, "
        + "so only use this when no prompt is ready. Check list_chats first to avoid creating a duplicate chat.",
      inputSchema: z.object({ projectId: z.string().describe("Id of the project") }),
    },
    ({ projectId }) => commandResult(host, { type: "chat.create", projectId }),
  )

  tools.registerTool(
    "get_chat",
    {
      title: "Read a chat",
      description:
        "Read a chat's status and its most recent transcript entries, flattened to role, text and tool name. "
        + "busy tells whether a turn is running, cursor is the value to pass to wait_for_chat, and queuedMessages lists messages waiting for the chat to become idle. "
        + "Use it to check what already happened before sending anything new.",
      inputSchema: z.object({
        chatId: chatIdField,
        limit: z.number().int().min(1).max(MAX_ENTRY_LIMIT).optional().describe(`How many recent entries to read (default ${DEFAULT_ENTRY_LIMIT}, max ${MAX_ENTRY_LIMIT})`),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ chatId, limit }) => {
      const snapshot = readChat(host, chatId, Math.min(limit ?? DEFAULT_ENTRY_LIMIT, MAX_ENTRY_LIMIT))
      if (!snapshot) return fail(`Chat ${chatId} was not found.`)
      const queued = snapshot.queuedMessages.length > 0
      return jsonResult({
        chatId,
        title: snapshot.runtime.title,
        status: snapshot.runtime.status,
        busy: BUSY_STATUSES.has(snapshot.runtime.status) || queued,
        provider: snapshot.runtime.provider,
        model: latestModel(snapshot.messages),
        hasOlder: snapshot.history.hasOlder,
        cursor: newestEntryTime(snapshot.messages),
        queuedMessages: snapshot.queuedMessages.map((message) => ({
          id: message.id,
          content: clipText(message.content, QUEUED_PREVIEW_CHARS),
          createdAt: message.createdAt,
          origin: message.origin ? toJson(message.origin) : null,
        })),
        entries: flattenEntries(snapshot.messages),
      })
    },
  )

  tools.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        "Send a prompt to a chat, or start a new chat in a project with projectId, and run a turn. Send ONCE per user request and pass an idempotencyKey: repeating the same request never starts duplicate work. "
        + `Waits up to timeoutSeconds (default ${DEFAULT_WAIT_SECONDS}) for the turn and returns done, assistantText, activity, a cursor and a \`next\` instruction. `
        + "If done is false the turn is still running: do NOT send again, call wait_for_chat with the chatId and cursor. "
        + "A status of waiting_for_user means a tool request needs answer_tool_request or respond_tool. If the chat is busy the message is queued behind the running turn (queued: true).",
      inputSchema: z.object({
        chatId: z.string().optional().describe("Existing chat to send to. Prefer this when continuing a conversation"),
        projectId: z.string().optional().describe("Project in which to start a new chat when chatId is omitted"),
        content: z.string().describe("The prompt text"),
        idempotencyKey: z.string().min(1).max(200).optional().describe("A stable string for this user request. Repeating the call with the same key returns the original chat without starting new work"),
        provider: z.enum(AGENT_PROVIDERS).optional().describe("Agent provider for a new chat"),
        model: z.string().optional().describe("Model id"),
        planMode: z.boolean().optional().describe("Run in plan mode"),
        attachments: z.array(attachmentSchema).optional().describe("Attachments returned by upload_attachment"),
        wait: z.boolean().optional().describe("Wait for the turn to finish (default true). False returns right after the message is accepted"),
        timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional().describe(`Longest wait in seconds (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}; shorter on connections that cannot stream progress)`),
      }),
    },
    async ({ chatId, projectId, content, idempotencyKey, provider, model, planMode, attachments, wait, timeoutSeconds }, ctx) => {
      if (!chatId && !projectId) return fail("Give either chatId or projectId.")
      const command: SendCommand = { type: "chat.send", chatId, projectId, content, provider, model, planMode, attachments }
      const guarded = await guardedChatSend(host, command, idempotencyKey)
      if (!guarded.ok) return fail(guarded.message)
      return followReply(host, ctx, {
        chatId: guarded.record.chatId,
        baseline: guarded.record.baseline,
        queuedMessageId: guarded.record.queuedMessageId,
        queuedContent: content,
        wait: wait ?? true,
        timeoutSeconds,
        duplicateVia: guarded.duplicateVia,
      })
    },
  )

  tools.registerTool(
    "wait_for_chat",
    {
      title: "Wait for a chat",
      description:
        "Follow a running turn without sending anything. Waits until the chat stops working (or the time runs out) and returns the same shape as send_message: done, assistantText and activity since cursor, pendingToolRequests, a new cursor and `next`. "
        + "Call it repeatedly with the returned cursor until done is true. Use this, not send_message, after a timeout.",
      inputSchema: z.object({
        chatId: chatIdField,
        cursor: z.number().optional().describe("The cursor returned by send_message, wait_for_chat or get_chat. Omit to follow the latest turn"),
        timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional().describe(`Longest wait in seconds (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}; shorter on connections that cannot stream progress)`),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ chatId, cursor, timeoutSeconds }, ctx) => {
      if (!readChat(host, chatId, 1)) return fail(`Chat ${chatId} was not found.`)
      return followReply(host, ctx, {
        chatId,
        baseline: cursor ?? latestTurnBaseline(host, chatId),
        wait: true,
        timeoutSeconds,
      })
    },
  )

  tools.registerTool(
    "enqueue_message",
    {
      title: "Queue a message",
      description:
        "Queue a message to run when the chat becomes idle, instead of interrupting the running turn. Identical content already queued in the chat is not queued twice. "
        + "Follow it with wait_for_chat; do not send it again.",
      inputSchema: z.object({ chatId: chatIdField, content: z.string().describe("The prompt text") }),
    },
    async ({ chatId, content }) => {
      const guarded = await guardedEnqueue(host, chatId, content)
      return guarded.ok ? acceptedReport(guarded.record, guarded.duplicateVia) : fail(guarded.message)
    },
  )

  tools.registerTool(
    "cancel_chat",
    {
      title: "Cancel the running turn",
      description: "Stop the turn currently running in a chat. Use it when the user asks to stop; waiting with wait_for_chat never cancels work.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    ({ chatId }) => commandResult(host, { type: "chat.cancel", chatId }),
  )

  tools.registerTool(
    "rename_chat",
    {
      title: "Rename a chat",
      description: "Change a chat's title.",
      inputSchema: z.object({ chatId: chatIdField, title: z.string().describe("New title") }),
    },
    ({ chatId, title }) => commandResult(host, { type: "chat.rename", chatId, title }),
  )

  tools.registerTool(
    "archive_chat",
    {
      title: "Archive a chat",
      description: "Move a chat to the archive; unarchive_chat restores it.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    ({ chatId }) => commandResult(host, { type: "chat.archive", chatId }),
  )

  tools.registerTool(
    "unarchive_chat",
    {
      title: "Unarchive a chat",
      description: "Restore an archived chat to the sidebar.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    ({ chatId }) => commandResult(host, { type: "chat.unarchive", chatId }),
  )

  tools.registerTool(
    "fork_chat",
    {
      title: "Fork a chat",
      description: "Create a new chat that continues from an existing one; returns the new chatId.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    async ({ chatId }) => {
      const outcome = await runCommand(host, { type: "chat.fork", chatId })
      if (!outcome.ok) return fail(outcome.message)
      const forked = isJsonObject(outcome.result) ? (outcome.result.chatId ?? outcome.result.id) : undefined
      return jsonResult({ chatId: typeof forked === "string" ? forked : null, forkedFrom: chatId })
    },
  )

  tools.registerTool(
    "delete_chat",
    {
      title: "Delete a chat",
      description: "Permanently delete a chat and its whole transcript. This cannot be undone.",
      inputSchema: z.object({ chatId: chatIdField }),
      annotations: { destructiveHint: true },
    },
    ({ chatId }) => commandResult(host, { type: "chat.delete", chatId }),
  )

  tools.registerTool(
    "list_pending_tool_requests",
    {
      title: "List pending tool requests",
      description: "List tool permission requests and interactive questions in a chat that still wait for an answer.",
      inputSchema: z.object({ chatId: chatIdField }),
      annotations: { readOnlyHint: true },
    },
    ({ chatId }) => {
      const snapshot = readChat(host, chatId, MAX_ENTRY_LIMIT)
      if (!snapshot) return fail(`Chat ${chatId} was not found.`)
      return jsonResult({ chatId, status: snapshot.runtime.status, pending: pendingToolRequests(snapshot.messages) })
    },
  )

  tools.registerTool(
    "answer_tool_request",
    {
      title: "Answer a tool request",
      description: "Allow, deny or answer a pending tool permission request (kind tool_request in list_pending_tool_requests).",
      inputSchema: z.object({
        chatId: chatIdField,
        toolRequestId: z.string().describe("toolRequestId from list_pending_tool_requests"),
        decision: decisionSchema.describe("The decision"),
      }),
    },
    ({ chatId, toolRequestId, decision }) => commandResult(host, { type: "chat.toolRequestAnswer", chatId, toolRequestId, decision }),
  )

  tools.registerTool(
    "respond_tool",
    {
      title: "Respond to an interactive tool",
      description: "Answer an interactive tool call such as a question or plan approval (kind interactive_tool in list_pending_tool_requests).",
      inputSchema: z.object({
        chatId: chatIdField,
        toolUseId: z.string().describe("toolUseId from list_pending_tool_requests"),
        result: jsonValueSchema.describe("The answer, any JSON value"),
      }),
    },
    ({ chatId, toolUseId, result }) => commandResult(host, { type: "chat.respondTool", chatId, toolUseId, result }),
  )
}
