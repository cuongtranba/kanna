export type WorkflowStatus = "running" | "completed" | "failed" | "killed" | "unknown"
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
  tokens?: number
  toolCalls?: number
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
export type WorkflowAgentSummary = Omit<WorkflowAgentProgress, "promptPreview" | "lastToolSummary">
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

const KNOWN_STATUS: ReadonlySet<string> = new Set(["running", "completed", "failed", "killed"])

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string | undefined { return typeof v === "string" ? v : undefined }
function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined }

function parseAgents(progress: unknown): WorkflowAgentProgress[] {
  if (!Array.isArray(progress)) return []
  const out: WorkflowAgentProgress[] = []
  for (const item of progress) {
    const r = rec(item)
    if (!r || r.type !== "workflow_agent") continue
    out.push({
      index: num(r.index) ?? out.length + 1,
      label: str(r.label) ?? "agent",
      phaseIndex: num(r.phaseIndex),
      phaseTitle: str(r.phaseTitle),
      agentId: str(r.agentId),
      model: str(r.model),
      state: str(r.state) ?? "unknown",
      lastToolName: str(r.lastToolName),
      lastToolSummary: str(r.lastToolSummary),
      promptPreview: str(r.promptPreview),
      tokens: num(r.tokens),
      toolCalls: num(r.toolCalls),
      startedAt: num(r.startedAt),
      lastProgressAt: num(r.lastProgressAt),
    })
  }
  return out
}

function parsePhases(phases: unknown): WorkflowPhase[] {
  if (!Array.isArray(phases)) return []
  const out: WorkflowPhase[] = []
  for (const item of phases) {
    const r = rec(item)
    if (!r) continue
    const title = str(r.title)
    if (!title) continue
    out.push({ title, detail: str(r.detail) })
  }
  return out
}

export function parseWorkflowRunFile(raw: unknown): WorkflowRun | null {
  const r = rec(raw)
  if (!r) return null
  const runId = str(r.runId)
  if (!runId) return null
  const rawStatus = str(r.status)
  const status: WorkflowStatus = rawStatus && KNOWN_STATUS.has(rawStatus) ? (rawStatus as WorkflowStatus) : "unknown"
  const resultVal = r.result
  return {
    runId,
    taskId: str(r.taskId),
    workflowName: str(r.workflowName),
    status,
    startTime: num(r.startTime),
    durationMs: num(r.durationMs),
    agentCount: num(r.agentCount),
    totalTokens: num(r.totalTokens),
    totalToolCalls: num(r.totalToolCalls),
    phases: parsePhases(r.phases),
    agents: parseAgents(r.workflowProgress),
    result: typeof resultVal === "string" ? resultVal : resultVal == null ? null : JSON.stringify(resultVal),
    error: str(r.error) ?? (r.error == null ? null : String(r.error)),
    summary: str(r.summary) ?? null,
    script: str(r.script),
    scriptPath: str(r.scriptPath),
    args: typeof r.args === "string" ? r.args : r.args == null ? undefined : JSON.stringify(r.args),
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
    agents: run.agents.map(({ promptPreview: _promptPreview, lastToolSummary: _lastToolSummary, ...keep }) => keep),
  }
}
