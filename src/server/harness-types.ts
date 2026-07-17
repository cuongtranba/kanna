import type { AccountInfo, AgentProvider, NormalizedToolCall, SlashCommand, TranscriptEntry } from "../shared/types"

export interface HarnessEvent {
  type: "transcript" | "session_token" | "rate_limit"
  entry?: TranscriptEntry
  sessionToken?: string
  rateLimit?: { resetAt: number; tz: string }
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

export interface ClaudeSessionHandle {
  provider: "claude"
  stream: AsyncIterable<HarnessEvent>
  getAccountInfo?: () => Promise<AccountInfo | null>
  interrupt: () => Promise<void>
  close: () => void
  sendPrompt: (content: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  setPermissionMode: (planMode: boolean) => Promise<void>
  getSupportedCommands: () => Promise<SlashCommand[]>
  /** Present only for keep-alive channel-delivery sessions; drives turn 2+. */
  pushChannelPrompt?: (text: string) => Promise<void>
}
