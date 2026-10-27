import { z } from "zod"
import { isJsonObject } from "../../shared/json"
import type { ChatHistoryPage } from "../../shared/types"
import { toJsonValue } from "../json-boundary"
import { fail } from "../kanna-mcp-tool"
import { acceptedReport, followReply, guardedChatSend, guardedEnqueue } from "./remote-mcp-follow"
import { IDEMPOTENCY_KEY_FIELD, TIMEOUT_SECONDS_FIELD, WAIT_FIELD } from "./remote-mcp-tool-fields"
import { DEFAULT_WAIT_SECONDS } from "./remote-mcp-follow-view"
import { latestTurnBaseline, type SendCommand } from "./send-and-wait"
import { commandTool, mcpOnlyTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"
import {
  clipText,
  flattenEntries,
  jsonResult,
  latestModel,
  newestEntryTime,
  pendingToolRequests,
  readChat,
  runCommand,
} from "./remote-mcp-views"

const DEFAULT_ENTRY_LIMIT = 50
const MAX_ENTRY_LIMIT = 500
const QUEUED_PREVIEW_CHARS = 200
const BUSY_STATUSES: ReadonlySet<string> = new Set(["starting", "running"])

const ORIGIN_REASON = "Stamped by the server with the authenticated MCP caller (client, tool and call id); a client-supplied origin is discarded."

function pageReply(chatId: string, page: ChatHistoryPage) {
  return jsonResult({
    chatId,
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
    entries: flattenEntries(page.messages),
  })
}

export const chatTools: readonly RemoteTool[] = [
  commandTool({
    name: "create_chat",
    title: "Create a chat",
    description:
      "Create an empty chat in a project and return its chatId. Rarely needed: send_message with projectId opens a new chat and sends the first prompt in one call, "
      + "so only use this when no prompt is ready. Check list_chats first to avoid creating a duplicate chat.",
    command: "chat.create",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.create", ...args }),
  }),
  topicTool({
    name: "get_chat",
    title: "Read a chat",
    description:
      "Read a chat's status and its most recent transcript entries, flattened to role, text and tool name. "
      + "busy tells whether a turn is running, cursor is the value to pass to wait_for_chat, and queuedMessages lists messages waiting for the chat to become idle. "
      + "hasOlder and olderCursor page back through history: pass olderCursor as beforeCursor to read the next older page, which returns only chatId, hasOlder, olderCursor and entries. "
      + "Use it to check what already happened before sending anything new.",
    annotations: { readOnlyHint: true },
    topic: "chat",
    input: z.object({
      chatId: z.string().describe("Id of the chat"),
      limit: z.number().int().min(1).max(MAX_ENTRY_LIMIT).optional().describe(`How many entries to read per page (default ${DEFAULT_ENTRY_LIMIT}, max ${MAX_ENTRY_LIMIT})`),
      beforeCursor: z.string().optional().describe("olderCursor from an earlier get_chat call; reads the page of entries older than it"),
    }),
    handle: ({ chatId, limit, beforeCursor }, { host }) => {
      const count = Math.min(limit ?? DEFAULT_ENTRY_LIMIT, MAX_ENTRY_LIMIT)
      if (beforeCursor !== undefined) {
        if (!host.store.getChat(chatId)) return fail(`Chat ${chatId} was not found.`)
        return pageReply(chatId, host.store.getMessagesPageBefore(chatId, beforeCursor, count))
      }
      const snapshot = readChat(host, chatId, count)
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
        olderCursor: snapshot.history.olderCursor,
        cursor: newestEntryTime(snapshot.messages),
        queuedMessages: snapshot.queuedMessages.map((message) => ({
          id: message.id,
          content: clipText(message.content, QUEUED_PREVIEW_CHARS),
          createdAt: message.createdAt,
          origin: message.origin ? toJsonValue(message.origin) : null,
        })),
        entries: flattenEntries(snapshot.messages),
      })
    },
  }),
  commandTool({
    name: "send_message",
    title: "Send a message",
    description:
      "Send a prompt to a chat, or start a new chat in a project with projectId, and run a turn. Send ONCE per user request and pass an idempotencyKey: repeating the same request never starts duplicate work. "
      + `Waits up to timeoutSeconds (default ${DEFAULT_WAIT_SECONDS}) for the turn and returns done, assistantText, activity, a cursor and a \`next\` instruction. `
      + "If done is false the turn is still running: do NOT send again, call wait_for_chat with the chatId and cursor. "
      + "A status of waiting_for_user means a tool request needs answer_tool_request or respond_tool. If the chat is busy the message is queued behind the running turn (queued: true).",
    command: "chat.send",
    input: (params) =>
      params.omit({ origin: true, clientTraceId: true }).extend({
        idempotencyKey: IDEMPOTENCY_KEY_FIELD,
        wait: WAIT_FIELD,
        timeoutSeconds: TIMEOUT_SECONDS_FIELD,
      }),
    hidden: {
      origin: ORIGIN_REASON,
      clientTraceId: "Correlates a browser performance trace; an MCP client has no browser trace to correlate with.",
    },
    handle: async ({ idempotencyKey, wait, timeoutSeconds, ...fields }, { host, ctx }) => {
      if (!fields.chatId && !fields.projectId) return fail("Give either chatId or projectId.")
      const command: SendCommand = { type: "chat.send", ...fields }
      const guarded = await guardedChatSend(host, command, idempotencyKey)
      if (!guarded.ok) return fail(guarded.message)
      return followReply(host, ctx, {
        chatId: guarded.record.chatId,
        baseline: guarded.record.baseline,
        queuedMessageId: guarded.record.queuedMessageId,
        queuedContent: command.content,
        wait: wait ?? true,
        timeoutSeconds,
        duplicateVia: guarded.duplicateVia,
      })
    },
  }),
  mcpOnlyTool({
    name: "wait_for_chat",
    title: "Wait for a chat",
    description:
      "Follow a running turn without sending anything. Waits until the chat stops working (or the time runs out) and returns the same shape as send_message: done, assistantText and activity since cursor, pendingToolRequests, a new cursor and `next`. "
      + "Call it repeatedly with the returned cursor until done is true. Use this, not send_message, after a timeout.",
    annotations: { readOnlyHint: true },
    reason: "A long poll over the chat snapshot that streams MCP progress notifications; the web UI follows a chat through its WebSocket subscription instead.",
    input: z.object({
      chatId: z.string().describe("Id of the chat"),
      cursor: z.number().optional().describe("The cursor returned by send_message, wait_for_chat or get_chat. Omit to follow the latest turn"),
      timeoutSeconds: TIMEOUT_SECONDS_FIELD,
    }),
    handle: ({ chatId, cursor, timeoutSeconds }, { host, ctx }) => {
      if (!readChat(host, chatId, 1)) return fail(`Chat ${chatId} was not found.`)
      return followReply(host, ctx, {
        chatId,
        baseline: cursor ?? latestTurnBaseline(host, chatId),
        wait: true,
        timeoutSeconds,
      })
    },
  }),
  commandTool({
    name: "enqueue_message",
    title: "Queue a message",
    description:
      "Queue a message to run when the chat becomes idle, instead of interrupting the running turn. Identical content already queued in the chat is not queued twice, and an idempotencyKey makes a repeated call return the original. "
      + "Follow it with wait_for_chat; do not send it again.",
    command: "message.enqueue",
    input: (params) => params.omit({ origin: true }).extend({ idempotencyKey: IDEMPOTENCY_KEY_FIELD }),
    hidden: { origin: ORIGIN_REASON },
    handle: async ({ idempotencyKey, ...fields }, { host }) => {
      const guarded = await guardedEnqueue(host, { type: "message.enqueue", ...fields }, idempotencyKey)
      return guarded.ok ? acceptedReport(guarded.record, guarded.duplicateVia) : fail(guarded.message)
    },
  }),
  commandTool({
    name: "cancel_chat",
    title: "Cancel the running turn",
    description: "Stop the turn currently running in a chat. Use it when the user asks to stop; waiting with wait_for_chat never cancels work.",
    command: "chat.cancel",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.cancel", ...args }),
  }),
  commandTool({
    name: "rename_chat",
    title: "Rename a chat",
    description: "Change a chat's title.",
    command: "chat.rename",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.rename", ...args }),
  }),
  commandTool({
    name: "archive_chat",
    title: "Archive a chat",
    description: "Move a chat to the archive; unarchive_chat restores it.",
    command: "chat.archive",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.archive", ...args }),
  }),
  commandTool({
    name: "unarchive_chat",
    title: "Unarchive a chat",
    description: "Restore an archived chat to the sidebar.",
    command: "chat.unarchive",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.unarchive", ...args }),
  }),
  commandTool({
    name: "fork_chat",
    title: "Fork a chat",
    description: "Create a new chat that continues from an existing one; returns the new chatId.",
    command: "chat.fork",
    input: (params) => params,
    handle: async (args, { host }) => {
      const outcome = await runCommand(host, { type: "chat.fork", ...args })
      if (!outcome.ok) return fail(outcome.message)
      const forked = isJsonObject(outcome.result) ? (outcome.result.chatId ?? outcome.result.id) : undefined
      return jsonResult({ chatId: typeof forked === "string" ? forked : null, forkedFrom: args.chatId })
    },
  }),
  commandTool({
    name: "delete_chat",
    title: "Delete a chat",
    description: "Permanently delete a chat and its whole transcript. This cannot be undone.",
    annotations: { destructiveHint: true },
    command: "chat.delete",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.delete", ...args }),
  }),
  topicTool({
    name: "list_pending_tool_requests",
    title: "List pending tool requests",
    description: "List tool permission requests and interactive questions in a chat that still wait for an answer.",
    annotations: { readOnlyHint: true },
    topic: "chat",
    input: z.object({ chatId: z.string().describe("Id of the chat") }),
    handle: ({ chatId }, { host }) => {
      const snapshot = readChat(host, chatId, MAX_ENTRY_LIMIT)
      if (!snapshot) return fail(`Chat ${chatId} was not found.`)
      return jsonResult({ chatId, status: snapshot.runtime.status, pending: pendingToolRequests(snapshot.messages) })
    },
  }),
  commandTool({
    name: "answer_tool_request",
    title: "Answer a tool request",
    description: "Allow, deny or answer a pending tool permission request (kind tool_request in list_pending_tool_requests).",
    command: "chat.toolRequestAnswer",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.toolRequestAnswer", ...args }),
  }),
  commandTool({
    name: "respond_tool",
    title: "Respond to an interactive tool",
    description: "Answer an interactive tool call such as a question or plan approval (kind interactive_tool in list_pending_tool_requests).",
    command: "chat.respondTool",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.respondTool", ...args }),
  }),
]
