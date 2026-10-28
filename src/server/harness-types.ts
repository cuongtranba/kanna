import type { LiveBlock } from "../shared/live-block"
import type { AccountInfo, AgentProvider, NormalizedToolCall, TranscriptEntry } from "../shared/types"

export type HarnessEvent =
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "session_token"; sessionToken: string }
  | { type: "rate_limit"; rateLimit: { resetAt: number; tz: string } }
  | { type: "live"; block: LiveBlock }

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

const INTERRUPT_GRACE_MS = 5_000

export async function interruptWithGrace(target: Pick<HarnessTurn, "interrupt">): Promise<void> {
  try {
    await Promise.race([
      target.interrupt(),
      new Promise<void>((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS)),
    ])
  } catch {
  }
}

export interface ClaudeSessionHandle extends HarnessTurn {
  provider: "claude"
  closed: Promise<void>
  sendPrompt: (content: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  setPermissionMode: (planMode: boolean) => Promise<void>
  pushChannelPrompt?: (text: string) => Promise<void>
}
