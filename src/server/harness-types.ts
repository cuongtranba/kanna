import type { AccountInfo, AgentProvider, NormalizedToolCall, TranscriptEntry } from "../shared/types"

export interface TeamTaskEvent {
  subtype: "task_started" | "task_progress" | "task_updated" | "task_notification"
  taskId: string
  toolUseId?: string
  description?: string
  subagentType?: string
  name?: string
  model?: string
  patch?: { status?: string; end_time?: number }
  status?: string
}

export interface HarnessEvent {
  type: "transcript" | "session_token" | "rate_limit" | "task"
  entry?: TranscriptEntry
  sessionToken?: string
  rateLimit?: { resetAt: number; tz: string }
  task?: TeamTaskEvent
}

export interface HarnessToolRequest {
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
}

export interface HarnessTurn {
  provider: AgentProvider
  stream: AsyncIterable<HarnessEvent>
  getAccountInfo?: () => Promise<AccountInfo | null>
  interrupt: () => Promise<void>
  close: () => void
}
