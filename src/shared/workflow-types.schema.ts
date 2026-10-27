import { z } from "zod"
import { WORKFLOW_STATUSES, type WorkflowRun } from "./workflow-types"
import { assertParity } from "./type-parity"

export const workflowRunSchema = z.object({
  runId: z.string(),
  taskId: z.string().optional(),
  workflowName: z.string().optional(),
  status: z.enum(WORKFLOW_STATUSES),
  startTime: z.number().optional(),
  durationMs: z.number().optional(),
  agentCount: z.number().optional(),
  totalTokens: z.number().optional(),
  totalToolCalls: z.number().optional(),
  phases: z.array(z.object({ title: z.string(), detail: z.string().optional() })),
  agents: z.array(z.object({
    index: z.number(),
    label: z.string(),
    phaseIndex: z.number().optional(),
    phaseTitle: z.string().optional(),
    agentId: z.string().optional(),
    model: z.string().optional(),
    state: z.string(),
    lastToolName: z.string().optional(),
    lastToolSummary: z.string().optional(),
    promptPreview: z.string().optional(),
    resultPreview: z.string().optional(),
    tokens: z.number().optional(),
    toolCalls: z.number().optional(),
    durationMs: z.number().optional(),
    startedAt: z.number().optional(),
    lastProgressAt: z.number().optional(),
  })),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  script: z.string().optional(),
  scriptPath: z.string().optional(),
  args: z.string().optional(),
})

assertParity<z.output<typeof workflowRunSchema>, WorkflowRun>()
