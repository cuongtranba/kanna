import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { AGENT_PROVIDERS } from "../../shared/core-types"
import { jsonValueSchema } from "../../shared/genui/json-schema"
import { isJsonObject } from "../../shared/json"
import { fail } from "../kanna-mcp-tool"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { sendAndWait } from "./send-and-wait"
import {
  commandResult,
  flattenEntries,
  jsonResult,
  latestModel,
  pendingToolRequests,
  readChat,
  runCommand,
} from "./remote-mcp-views"

const DEFAULT_ENTRY_LIMIT = 50
const MAX_ENTRY_LIMIT = 500
const DEFAULT_TIMEOUT_SECONDS = 120
const MAX_TIMEOUT_SECONDS = 600
const MS_PER_SECOND = 1000

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

export function registerChatTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "create_chat",
    {
      title: "Create a chat",
      description: "Create an empty chat in a project and return its chatId.",
      inputSchema: z.object({ projectId: z.string().describe("Id of the project") }),
    },
    ({ projectId }) => commandResult(host, { type: "chat.create", projectId }),
  )

  server.registerTool(
    "get_chat",
    {
      title: "Read a chat",
      description: "Read a chat's status and its most recent transcript entries, flattened to role, text and tool name.",
      inputSchema: z.object({
        chatId: chatIdField,
        limit: z.number().int().min(1).max(MAX_ENTRY_LIMIT).optional().describe(`How many recent entries to read (default ${DEFAULT_ENTRY_LIMIT}, max ${MAX_ENTRY_LIMIT})`),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ chatId, limit }) => {
      const snapshot = readChat(host, chatId, Math.min(limit ?? DEFAULT_ENTRY_LIMIT, MAX_ENTRY_LIMIT))
      if (!snapshot) return fail(`Chat ${chatId} was not found.`)
      return jsonResult({
        chatId,
        title: snapshot.runtime.title,
        status: snapshot.runtime.status,
        provider: snapshot.runtime.provider,
        model: latestModel(snapshot.messages),
        hasOlder: snapshot.history.hasOlder,
        entries: flattenEntries(snapshot.messages),
      })
    },
  )

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        "Send a prompt to a chat, or start a new chat in a project, and run a turn. By default waits for the turn to finish and returns the assistant text and any pending tool requests; "
        + "a status of waiting_for_user means a tool request needs answer_tool_request or respond_tool.",
      inputSchema: z.object({
        chatId: z.string().optional().describe("Existing chat to send to"),
        projectId: z.string().optional().describe("Project in which to start a new chat when chatId is omitted"),
        content: z.string().describe("The prompt text"),
        provider: z.enum(AGENT_PROVIDERS).optional().describe("Agent provider for a new chat"),
        model: z.string().optional().describe("Model id"),
        planMode: z.boolean().optional().describe("Run in plan mode"),
        attachments: z.array(attachmentSchema).optional().describe("Attachments returned by upload_attachment"),
        wait: z.boolean().optional().describe("Wait for the turn to finish (default true)"),
        timeoutSeconds: z.number().int().min(1).max(MAX_TIMEOUT_SECONDS).optional().describe(`Longest wait in seconds (default ${DEFAULT_TIMEOUT_SECONDS}, max ${MAX_TIMEOUT_SECONDS})`),
      }),
    },
    async ({ chatId, projectId, content, provider, model, planMode, attachments, wait, timeoutSeconds }) => {
      if (!chatId && !projectId) return fail("Give either chatId or projectId.")
      const outcome = await sendAndWait(host, {
        command: { type: "chat.send", chatId, projectId, content, provider, model, planMode, attachments },
        wait: wait ?? true,
        timeoutMs: Math.min(timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS) * MS_PER_SECOND,
      })
      if (!outcome.ok) return fail(outcome.message)
      return jsonResult({
        chatId: outcome.chatId,
        status: outcome.status,
        assistantText: outcome.assistantText,
        pendingToolRequests: outcome.pendingToolRequests,
        timedOut: outcome.timedOut,
      })
    },
  )

  server.registerTool(
    "enqueue_message",
    {
      title: "Queue a message",
      description: "Queue a message to run when the chat becomes idle, instead of interrupting the running turn.",
      inputSchema: z.object({ chatId: chatIdField, content: z.string().describe("The prompt text") }),
    },
    ({ chatId, content }) => commandResult(host, { type: "message.enqueue", chatId, content }),
  )

  server.registerTool(
    "cancel_chat",
    {
      title: "Cancel the running turn",
      description: "Stop the turn currently running in a chat.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    ({ chatId }) => commandResult(host, { type: "chat.cancel", chatId }),
  )

  server.registerTool(
    "rename_chat",
    {
      title: "Rename a chat",
      description: "Change a chat's title.",
      inputSchema: z.object({ chatId: chatIdField, title: z.string().describe("New title") }),
    },
    ({ chatId, title }) => commandResult(host, { type: "chat.rename", chatId, title }),
  )

  server.registerTool(
    "archive_chat",
    {
      title: "Archive a chat",
      description: "Move a chat to the archive; unarchive_chat restores it.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    ({ chatId }) => commandResult(host, { type: "chat.archive", chatId }),
  )

  server.registerTool(
    "unarchive_chat",
    {
      title: "Unarchive a chat",
      description: "Restore an archived chat to the sidebar.",
      inputSchema: z.object({ chatId: chatIdField }),
    },
    ({ chatId }) => commandResult(host, { type: "chat.unarchive", chatId }),
  )

  server.registerTool(
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

  server.registerTool(
    "delete_chat",
    {
      title: "Delete a chat",
      description: "Permanently delete a chat and its whole transcript. This cannot be undone.",
      inputSchema: z.object({ chatId: chatIdField }),
      annotations: { destructiveHint: true },
    },
    ({ chatId }) => commandResult(host, { type: "chat.delete", chatId }),
  )

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
