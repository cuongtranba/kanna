export const WORKFLOW_STATUSES = ["running", "completed", "failed", "killed", "unknown"] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]
export interface WorkflowPhase { title: string; detail?: string }
export interface WorkflowAgentProgress {
  index: number
  label: string
  phaseIndex?: number
  phaseTitle?: string
  agentId?: string
  model?: string
  state: string
  lastToolName?: string
  lastToolSummary?: string
  promptPreview?: string
  resultPreview?: string
  tokens?: number
  toolCalls?: number
  durationMs?: number
  startedAt?: number
  lastProgressAt?: number
}
export interface WorkflowRun {
  runId: string
  taskId?: string
  workflowName?: string
  status: WorkflowStatus
  startTime?: number
  durationMs?: number
  agentCount?: number
  totalTokens?: number
  totalToolCalls?: number
  phases: WorkflowPhase[]
  agents: WorkflowAgentProgress[]
  result?: string | null
  error?: string | null
  summary?: string | null
  script?: string
  scriptPath?: string
  args?: string
}
export type WorkflowAgentSummary = Omit<WorkflowAgentProgress, "promptPreview" | "resultPreview" | "lastToolSummary">
export interface WorkflowRunSummary {
  runId: string
  taskId?: string
  workflowName?: string
  status: WorkflowStatus
  startTime?: number
  durationMs?: number
  agentCount?: number
  totalTokens?: number
  totalToolCalls?: number
  phases: WorkflowPhase[]
  agents: WorkflowAgentSummary[]
}

import { isJsonObject, numberField, stringField, type JsonValue } from "./json"
import { oneOf } from "./vocab"

const isWorkflowStatus = oneOf(WORKFLOW_STATUSES)

function parseAgents(progress: JsonValue): WorkflowAgentProgress[] {
  if (!Array.isArray(progress)) return []
  const out: WorkflowAgentProgress[] = []
  for (const item of progress) {
    if (!isJsonObject(item) || item.type !== "workflow_agent") continue
    const r = item
    out.push({
      index: numberField(r, "index") ?? out.length + 1,
      label: stringField(r, "label") ?? "agent",
      phaseIndex: numberField(r, "phaseIndex"),
      phaseTitle: stringField(r, "phaseTitle"),
      agentId: stringField(r, "agentId"),
      model: stringField(r, "model"),
      state: stringField(r, "state") ?? "unknown",
      lastToolName: stringField(r, "lastToolName"),
      lastToolSummary: stringField(r, "lastToolSummary"),
      promptPreview: stringField(r, "promptPreview"),
      resultPreview: stringField(r, "resultPreview"),
      tokens: numberField(r, "tokens"),
      toolCalls: numberField(r, "toolCalls"),
      durationMs: numberField(r, "durationMs"),
      startedAt: numberField(r, "startedAt"),
      lastProgressAt: numberField(r, "lastProgressAt"),
    })
  }
  return out
}

function parsePhases(phases: JsonValue): WorkflowPhase[] {
  if (!Array.isArray(phases)) return []
  const out: WorkflowPhase[] = []
  for (const item of phases) {
    if (!isJsonObject(item)) continue
    const title = stringField(item, "title")
    if (!title) continue
    out.push({ title, detail: stringField(item, "detail") })
  }
  return out
}

export function parseWorkflowRunFile(raw: JsonValue): WorkflowRun | null {
  if (!isJsonObject(raw)) return null
  const r = raw
  const runId = stringField(r, "runId")
  if (!runId) return null
  const rawStatus = r.status
  const status: WorkflowStatus = isWorkflowStatus(rawStatus) ? rawStatus : "unknown"
  const resultVal = r.result
  let resultStr: string | null
  if (typeof resultVal === "string") {
    resultStr = resultVal
  } else if (resultVal == null) {
    resultStr = null
  } else {
    resultStr = JSON.stringify(resultVal)
  }
  const argsVal = r.args
  let argsStr: string | undefined
  if (typeof argsVal === "string") {
    argsStr = argsVal
  } else if (argsVal == null) {
    argsStr = undefined
  } else {
    argsStr = JSON.stringify(argsVal)
  }
  return {
    runId,
    taskId: stringField(r, "taskId"),
    workflowName: stringField(r, "workflowName"),
    status,
    startTime: numberField(r, "startTime"),
    durationMs: numberField(r, "durationMs"),
    agentCount: numberField(r, "agentCount"),
    totalTokens: numberField(r, "totalTokens"),
    totalToolCalls: numberField(r, "totalToolCalls"),
    phases: parsePhases(r.phases),
    agents: parseAgents(r.workflowProgress),
    result: resultStr,
    error: stringField(r, "error") ?? (r.error == null ? null : String(r.error)),
    summary: stringField(r, "summary") ?? null,
    script: stringField(r, "script"),
    scriptPath: stringField(r, "scriptPath"),
    args: argsStr,
  }
}

export function toRunSummary(run: WorkflowRun): WorkflowRunSummary {
  return {
    runId: run.runId,
    taskId: run.taskId,
    workflowName: run.workflowName,
    status: run.status,
    startTime: run.startTime,
    durationMs: run.durationMs,
    agentCount: run.agentCount,
    totalTokens: run.totalTokens,
    totalToolCalls: run.totalToolCalls,
    phases: run.phases,
    agents: run.agents.map(
      ({ promptPreview: _promptPreview, resultPreview: _resultPreview, lastToolSummary: _lastToolSummary, ...keep }) => keep,
    ),
  }
}
