import type { AccountInfo, AgentProvider, NormalizedToolCall, SlashCommand, TranscriptEntry } from "../shared/types"

export type HarnessEvent =
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "session_token"; sessionToken: string }
  | { type: "rate_limit"; rateLimit: { resetAt: number; tz: string } }

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
  closed: Promise<void>
  sendPrompt: (content: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  setPermissionMode: (planMode: boolean) => Promise<void>
  getSupportedCommands: () => Promise<SlashCommand[]>
  pushChannelPrompt?: (text: string) => Promise<void>
}
