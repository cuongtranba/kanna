import { z } from "zod"
import { defineCommand, defineCommands, REMOTE_ALLOWED, remoteExcluded } from "./define"
import { chatIdParams, chatIdShape, projectIdShape } from "./fragments"
import { remoteMcpOriginSchema } from "../command-origin.schema"
import { agentProviderSchema } from "../core-types.schema"
import { jsonObjectSchema, jsonValueSchema } from "../genui/json-schema"
import { cronJobPatchSchema } from "../cron/types.schema"
import { chatPermissionPolicyOverrideSchema, toolRequestDecisionSchema } from "../permission-policy.schema"
import { modelOptionsSchema } from "../provider-model-types.schema"
import { chatAttachmentSchema } from "../types.schema"

const stackBindingSchema = z.object({
  projectId: z.string(),
  worktreePath: z.string(),
  role: z.enum(["primary", "additional"]),
})

const messageDeliveryShape = {
  content: z.string().describe("The prompt text"),
  attachments: z.array(chatAttachmentSchema).optional().describe("Uploaded files to attach to the message"),
  provider: agentProviderSchema.optional().describe("Agent provider for a new chat"),
  model: z.string().optional().describe("Model id"),
  modelOptions: modelOptionsSchema.optional().describe("Per-provider model options such as reasoning effort or context window"),
  planMode: z.boolean().optional().describe("Run in plan mode"),
  autoResumeOnRateLimit: z.boolean().optional().describe("Resume the turn automatically when a rate limit clears"),
  origin: remoteMcpOriginSchema.optional(),
}

const chatAndQueuedMessageParams = z.object({ ...chatIdShape, queuedMessageId: z.string() })
const chatAndSchedule = { ...chatIdShape, scheduleId: z.string() }
const chatAndTunnelParams = z.object({ ...chatIdShape, tunnelId: z.string() })
const chatAndJobParams = z.object({ ...chatIdShape, jobId: z.string().describe("Id of the cron job") })

export const chatCommands = defineCommands(
  defineCommand("chat.create", {
    params: z.object({
      ...projectIdShape,
      stackId: z.string().optional().describe("Stack to start the chat in"),
      stackBindings: z.array(stackBindingSchema).optional().describe("Worktree bindings of the stack's projects"),
    }),
    summary: "Create an empty chat in a project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.fork", {
    params: chatIdParams,
    summary: "Fork a chat into a new one.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.rename", {
    params: z.object({ ...chatIdShape, title: z.string().describe("New title") }),
    summary: "Rename a chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.archive", {
    params: chatIdParams,
    summary: "Archive a chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.unarchive", {
    params: chatIdParams,
    summary: "Restore an archived chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.delete", {
    params: chatIdParams,
    summary: "Permanently delete a chat and its transcript.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.setDraftProtection", {
    params: z.object({ chatIds: z.array(z.string()) }),
    summary: "Mark chats whose unsent draft the browser protects.",
    risk: "write",
    remote: remoteExcluded(
      "Draft protection is state of one browser socket (the drafts that tab holds unsent); a remote MCP client has no such socket, so the command would protect nothing.",
    ),
  }),
  defineCommand("chat.markRead", {
    params: chatIdParams,
    summary: "Mark a chat as read.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.setPolicyOverride", {
    params: z.object({ ...chatIdShape, policyOverride: chatPermissionPolicyOverrideSchema.nullable() }),
    summary: "Set or clear the permission policy override of a chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.send", {
    params: z.object({
      chatId: z.string().optional().describe("Existing chat to send to. Prefer this when continuing a conversation"),
      projectId: z.string().optional().describe("Project in which to start a new chat when chatId is omitted"),
      clientTraceId: z.string().optional(),
      effort: z.string().optional().describe("Reasoning effort for the turn"),
      ...messageDeliveryShape,
    }),
    summary: "Send a prompt to a chat, or start a new chat in a project, and run a turn.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.cancel", {
    params: chatIdParams,
    summary: "Cancel the running turn of a chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.stopDraining", {
    params: chatIdParams,
    summary: "Stop a chat that is draining background work after its turn.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.loadHistory", {
    params: z.object({ ...chatIdShape, beforeCursor: z.string(), limit: z.number() }),
    summary: "Load a page of older transcript entries.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.respondTool", {
    params: z.object({
      ...chatIdShape,
      toolUseId: z.string().describe("toolUseId of the pending interactive tool call"),
      result: jsonValueSchema.describe("The answer, any JSON value"),
    }),
    summary: "Answer a pending interactive tool such as a question or plan approval.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.toolRequestAnswer", {
    params: z.object({
      ...chatIdShape,
      toolRequestId: z.string().describe("Id of the pending tool permission request"),
      decision: toolRequestDecisionSchema.describe("Allow or deny the tool call, or answer a question"),
    }),
    summary: "Allow or deny a pending tool permission request.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.respondSubagentTool", {
    params: z.object({ ...chatIdShape, runId: z.string(), toolUseId: z.string(), result: jsonObjectSchema }),
    summary: "Answer an interactive tool requested by a subagent run.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.cancelSubagentRun", {
    params: z.object({ ...chatIdShape, runId: z.string() }),
    summary: "Cancel a running subagent run.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("message.enqueue", {
    params: z.object({ ...chatIdShape, ...messageDeliveryShape }),
    summary: "Queue a message to run when the chat becomes idle.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("message.steer", {
    params: chatAndQueuedMessageParams,
    summary: "Deliver a queued message into the running turn.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("message.dequeue", {
    params: chatAndQueuedMessageParams,
    summary: "Remove a queued message.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("autoContinue.accept", {
    params: z.object({ ...chatAndSchedule, scheduledAt: z.number() }),
    summary: "Accept a proposed auto-continue and schedule it.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("autoContinue.reschedule", {
    params: z.object({ ...chatAndSchedule, scheduledAt: z.number() }),
    summary: "Move a scheduled auto-continue to another time.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("autoContinue.cancel", {
    params: z.object(chatAndSchedule),
    summary: "Cancel a scheduled auto-continue.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("cron.remove", {
    params: chatAndJobParams,
    summary: "Remove a cron job.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("cron.pause", {
    params: chatAndJobParams,
    summary: "Pause a cron job.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("cron.resume", {
    params: chatAndJobParams,
    summary: "Resume a paused cron job.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("cron.update", {
    params: z.object({ ...chatIdShape, jobId: z.string(), patch: cronJobPatchSchema }),
    summary: "Change a cron job's schedule, mode or instruction.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("workflows.getRun", {
    params: z.object({ ...chatIdShape, runId: z.string().describe("Id of the workflow run") }),
    summary: "Read the full detail of a workflow run.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("workflows.getAgentTranscript", {
    params: z.object({ ...chatIdShape, runId: z.string(), agentId: z.string() }),
    summary: "Read one agent's transcript within a workflow run.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagents.getRun", {
    params: z.object({ ...chatIdShape, agentId: z.string().describe("Id of the subagent run") }),
    summary: "Read the detail of a subagent run.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("backgroundTasks.getOutput", {
    params: z.object({ ...chatIdShape, taskId: z.string().describe("Id of the background task") }),
    summary: "Read the captured output of a background task.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("genui.dataset.query", {
    params: z.object({
      ...chatIdShape,
      dataset: jsonObjectSchema,
      query: jsonObjectSchema,
      refresh: z.boolean().optional(),
    }),
    summary: "Run a query against a generative-UI dataset.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("genui.dataset.approve", {
    params: z.object({ ...chatIdShape, server: z.string(), tool: z.string() }),
    summary: "Allow a generative-UI dataset to call an MCP tool for this chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("tunnel.accept", {
    params: chatAndTunnelParams,
    summary: "Accept a proposed Cloudflare tunnel for a chat's local port.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("tunnel.stop", {
    params: chatAndTunnelParams,
    summary: "Stop a running tunnel.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("tunnel.retry", {
    params: chatAndTunnelParams,
    summary: "Retry a failed tunnel.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
)
