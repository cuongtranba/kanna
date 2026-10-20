import { z } from "zod"
import { agentProviderSchema } from "./core-types.schema"
import { remoteMcpOriginSchema } from "./command-origin.schema"
import { cronModeSchema } from "./cron/types.schema"
import { inboundHandlerModeSchema } from "./inbound/handler.schema"
import { jsonObjectSchema, jsonValueSchema } from "./genui/json-schema"
import { toolRequestDecisionSchema } from "./permission-policy.schema"
import { normalizedToolCallSchema } from "./tool-call-types.schema"
import { chatAttachmentSchema } from "./types.schema"
import type { ChatHistoryPage } from "./types"
import type { CodexErrorInfoTag } from "./codex-error-classification"
import type { TranscriptEntry } from "./transcript-types"
import { assertParity } from "./type-parity"

const codexErrorInfoTagSchema = z.enum([
  "serverOverloaded",
  "internalServerError",
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "usageLimitExceeded",
  "sessionBudgetExceeded",
  "unauthorized",
  "contextWindowExceeded",
  "badRequest",
  "cyberPolicy",
  "sandboxError",
  "threadRollbackFailed",
  "activeTurnNotSteerable",
  "other",
])

const cronSkipReasonSchema = z.enum(["chat_busy", "previous_run_active", "background_work_pending", "server_offline"])

const toolRequestStatusSchema = z.enum(["pending", "answered", "timeout", "canceled", "session_closed", "arg_mismatch"])

const providerUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  costUsd: z.number().optional(),
})

const contextWindowUsageSnapshotSchema = z.object({
  usedTokens: z.number(),
  totalProcessedTokens: z.number().optional(),
  maxTokens: z.number().optional(),
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  reasoningOutputTokens: z.number().optional(),
  lastUsedTokens: z.number().optional(),
  lastInputTokens: z.number().optional(),
  lastCachedInputTokens: z.number().optional(),
  lastOutputTokens: z.number().optional(),
  lastReasoningOutputTokens: z.number().optional(),
  toolUses: z.number().optional(),
  durationMs: z.number().optional(),
  costUsd: z.number().optional(),
  compactsAutomatically: z.boolean(),
})

const entryBase = {
  _id: z.string(),
  messageId: z.string().optional(),
  createdAt: z.number(),
  hidden: z.boolean().optional(),
  debugRaw: z.string().optional(),
}

function entry<const K extends string, S extends z.core.$ZodShape>(kind: K, shape: S) {
  return z.object({ ...entryBase, kind: z.literal(kind), ...shape })
}

export const transcriptEntrySchema = z.discriminatedUnion("kind", [
  entry("user_prompt", {
    content: z.string(),
    attachments: z.array(chatAttachmentSchema).optional(),
    steered: z.boolean().optional(),
    autoContinue: z.object({ scheduleId: z.string() }).optional(),
    subagentMentions: z.array(z.object({ subagentId: z.string(), raw: z.string() })).optional(),
    unknownSubagentMentions: z.array(z.object({ name: z.string(), raw: z.string() })).optional(),
    expandedCommand: z.object({ name: z.string(), kind: z.enum(["command", "skill"]) }).optional(),
    origin: remoteMcpOriginSchema.optional(),
  }),
  entry("system_init", {
    provider: agentProviderSchema,
    model: z.string(),
    tools: z.array(z.string()),
    agents: z.array(z.string()),
    slashCommands: z.array(z.string()),
    mcpServers: z.array(z.object({ name: z.string(), status: z.string(), error: z.string().optional() })),
  }),
  entry("account_info", {
    accountInfo: z.object({
      email: z.string().optional(),
      organization: z.string().optional(),
      subscriptionType: z.string().optional(),
      tokenSource: z.string().optional(),
      apiKeySource: z.string().optional(),
      oauthKeyMasked: z.string().optional(),
    }),
  }),
  entry("assistant_text", { text: z.string() }),
  entry("assistant_thinking", { text: z.string(), signature: z.string().optional() }),
  entry("api_error", {
    status: z.number(),
    text: z.string(),
    requestId: z.string().optional(),
    apiErrorReason: z.string().optional(),
  }),
  entry("policy_refusal", { text: z.string(), requestId: z.string().optional() }),
  entry("tool_call", { tool: normalizedToolCallSchema }),
  entry("tool_result", {
    toolId: z.string(),
    content: z.union([z.string(), jsonObjectSchema, z.array(jsonValueSchema).readonly(), z.null()]),
    isError: z.boolean().optional(),
    persisted: z.object({
      filePath: z.string(),
      originalSize: z.number(),
      isJson: z.boolean(),
      truncated: z.literal(true),
    }).optional(),
  }),
  entry("result", {
    subtype: z.enum(["success", "error", "cancelled"]),
    isError: z.boolean(),
    durationMs: z.number(),
    result: z.string(),
    costUsd: z.number().optional(),
    cumulativeCostUsd: z.number().optional(),
    usage: providerUsageSchema.optional(),
    pendingWorkflowCount: z.number().optional(),
    codexErrorInfo: codexErrorInfoTagSchema.optional(),
  }),
  entry("status", {
    status: z.string(),
    backgroundTaskId: z.string().optional(),
    backgroundTaskIdsSnapshot: z.array(z.string()).optional(),
    backgroundTasksSnapshot: z.array(z.object({
      id: z.string(),
      taskType: z.string().nullable(),
      description: z.string().nullable(),
    })).optional(),
  }),
  entry("context_window_updated", { usage: contextWindowUsageSnapshotSchema }),
  entry("compact_boundary", {
    compactMetadata: z.object({
      trigger: z.enum(["auto", "manual"]).optional(),
      preTokens: z.number().optional(),
      postTokens: z.number().optional(),
      durationMs: z.number().optional(),
    }).optional(),
  }),
  entry("compact_summary", { summary: z.string() }),
  entry("context_cleared", {}),
  entry("interrupted", {}),
  entry("loop_disarmed", {
    reason: z.enum(["goal_met", "user_send", "chat_deleted", "repeated_failures"]),
    resumable: z.boolean(),
    trackingFileRel: z.string().optional(),
    workdirAbs: z.string().optional(),
  }),
  entry("memory_loaded", { path: z.string() }),
  entry("auto_continue_prompt", { scheduleId: z.string() }),
  entry("pending_tool_request", {
    toolRequestId: z.string(),
    toolName: z.string(),
    arguments: jsonObjectSchema,
  }),
  entry("tool_request_resolved", {
    toolRequestId: z.string(),
    status: toolRequestStatusSchema,
    decision: toolRequestDecisionSchema.optional(),
  }),
  entry("cron_armed", {
    jobId: z.string(),
    instruction: z.string(),
    mode: cronModeSchema,
    scheduleText: z.string(),
    scheduleHuman: z.string(),
    nextFireAt: z.number().nullable(),
    model: z.string().optional(),
    upcomingFires: z.array(z.number()).readonly().optional(),
    cwd: z.string().optional(),
  }),
  entry("cron_command_error", {
    message: z.string(),
    input: z.string().optional(),
    suggestion: z.string().optional(),
  }),
  entry("cron_run", {
    jobId: z.string(),
    runId: z.string(),
    instruction: z.string(),
    spawnedChatId: z.string().optional(),
    firedAt: z.number(),
  }),
  entry("cron_run_skipped", {
    jobId: z.string(),
    reason: cronSkipReasonSchema,
    missedCount: z.number().optional(),
  }),
  entry("cron_list", { help: z.boolean().optional() }),
  entry("cron_job_change", {
    jobId: z.string(),
    change: z.enum(["removed", "paused", "resumed", "updated"]),
  }),
  entry("webhook_delivery", {
    hookId: z.string(),
    hookName: z.string(),
    mode: inboundHandlerModeSchema,
    deliveryId: z.string(),
    message: z.string().optional(),
  }),
  entry("inbound_delivery", {
    sourceKind: z.enum(["mcp", "webhook"]),
    sourceId: z.string(),
    sourceName: z.string(),
    mode: inboundHandlerModeSchema,
    deliveryId: z.string(),
    threadId: z.string(),
    message: z.string().optional(),
  }),
])

export const transcriptEntriesSchema = z.array(transcriptEntrySchema)

export const chatHistoryPageSchema = z.object({
  messages: transcriptEntriesSchema,
  hasOlder: z.boolean(),
  olderCursor: z.string().nullable(),
})

assertParity<z.output<typeof codexErrorInfoTagSchema>, CodexErrorInfoTag>()
assertParity<z.output<typeof transcriptEntrySchema>, TranscriptEntry>()
assertParity<z.output<typeof chatHistoryPageSchema>, ChatHistoryPage>()
