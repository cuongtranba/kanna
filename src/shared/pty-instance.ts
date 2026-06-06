export type PtyInstancePhase =
  | "spawning"
  | "trust-dialog"
  | "ready"
  | "streaming"
  | "cancelling"
  | "exited"

export type PtyInstanceSmokeTest = "pending" | "pass" | "fail"

/**
 * Live snapshot of Claude Code's ephemeral TUI spinner status line, parsed from
 * the PTY output ring (PTY driver only). e.g. the line
 *   "✻ Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)"
 * decodes to verb="Whirlpooling", elapsedSeconds=671, tokens=40500,
 * effort="almost done thinking with xhigh effort". This is process metadata
 * surfaced over the live-status channel, NOT a transcript event.
 */
export interface PtyTuiStatus {
  verb: string | null
  elapsedSeconds: number | null
  tokens: number | null
  effort: string | null
  raw: string
}

export interface PtyInstanceState {
  chatId: string
  sessionId: string | null
  pid: number | null
  cwd: string
  model: string
  accountLabel: string | null
  oauthMasked: string | null
  phase: PtyInstancePhase
  startedAt: number
  lastEventAt: number
  turnCount: number
  tokensIn: number
  tokensOut: number
  planMode: boolean | null
  smokeTest: PtyInstanceSmokeTest | null
  outputRingTail: string | null
  exitedAt: number | null
  exitCode: number | null
  rssBytes: number | null
  rssPeakBytes: number | null
  cpuPercent: number | null
  cpuPeakPercent: number | null
  tuiStatus: PtyTuiStatus | null
}

export type PtyInstanceDelta =
  | { type: "added"; instance: PtyInstanceState }
  | { type: "updated"; instance: PtyInstanceState }
  | { type: "removed"; chatId: string }

export interface PtyInstancesSnapshot {
  instances: PtyInstanceState[]
}
