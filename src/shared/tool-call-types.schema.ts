import { z } from "zod"
import { jsonObjectSchema } from "./genui/json-schema"
import type { NormalizedToolCall } from "./tool-call-types"
import { assertParity } from "./type-parity"

const askUserQuestionItemSchema = z.object({
  id: z.string().optional(),
  question: z.string(),
  header: z.string().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
  multiSelect: z.boolean().optional(),
})

const taskStatusSchema = z.enum(["pending", "in_progress", "completed"])

const beaconToolOpSchema = z.enum(["list", "read", "stat", "glob", "grep", "fetch", "exec", "script", "upload", "download"])

const toolCallBase = {
  kind: z.literal("tool"),
  toolName: z.string(),
  toolId: z.string(),
  rawInput: jsonObjectSchema.optional(),
}

function toolCall<const K extends string, I extends z.ZodType>(toolKind: K, input: I) {
  return z.object({ ...toolCallBase, toolKind: z.literal(toolKind), input })
}

export const normalizedToolCallSchema = z.discriminatedUnion("toolKind", [
  toolCall("ask_user_question", z.object({ questions: z.array(askUserQuestionItemSchema) })),
  toolCall("exit_plan_mode", z.object({ plan: z.string().optional(), summary: z.string().optional() })),
  toolCall("todo_write", z.object({
    todos: z.array(z.object({ content: z.string(), status: taskStatusSchema, activeForm: z.string() })),
  })),
  toolCall("task_create", z.object({ subject: z.string(), description: z.string(), activeForm: z.string().optional() })),
  toolCall("task_update", z.object({
    taskId: z.string(),
    subject: z.string().optional(),
    activeForm: z.string().optional(),
    status: z.union([taskStatusSchema, z.literal("deleted")]).optional(),
  })),
  toolCall("task_get", z.object({ taskId: z.string() })),
  toolCall("task_list", z.record(z.string(), z.never())),
  toolCall("skill", z.object({ skill: z.string() })),
  toolCall("glob", z.object({ pattern: z.string() })),
  toolCall("grep", z.object({ pattern: z.string(), outputMode: z.string().optional() })),
  toolCall("bash", z.object({
    command: z.string(),
    description: z.string().optional(),
    timeoutMs: z.number().optional(),
    runInBackground: z.boolean().optional(),
  })),
  toolCall("web_search", z.object({ query: z.string() })),
  toolCall("read_file", z.object({ filePath: z.string() })),
  toolCall("write_file", z.object({ filePath: z.string(), content: z.string() })),
  toolCall("edit_file", z.object({ filePath: z.string(), oldString: z.string(), newString: z.string() })),
  toolCall("delete_file", z.object({ filePath: z.string(), content: z.string() })),
  toolCall("subagent_task", z.object({ subagentType: z.string().optional() })),
  toolCall("mcp_generic", z.object({ server: z.string(), tool: z.string(), payload: jsonObjectSchema })),
  toolCall("beacon", z.object({ op: beaconToolOpSchema, beaconId: z.string(), summary: z.string() })),
  toolCall("offer_download", z.object({ path: z.string(), label: z.string().optional() })),
  toolCall("preview_file", z.object({ path: z.string(), label: z.string().optional() })),
  toolCall("image_generation", z.object({
    revisedPrompt: z.string().nullable(),
    status: z.enum(["in_progress", "completed", "failed"]),
  })),
  toolCall("image_view", z.object({ path: z.string(), contentUrl: z.string(), mimeType: z.string() })),
  toolCall("workflow", z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    scriptPath: z.string().optional(),
  })),
  toolCall("unknown_tool", z.object({ payload: jsonObjectSchema })),
])

assertParity<z.output<typeof normalizedToolCallSchema>, NormalizedToolCall>()
