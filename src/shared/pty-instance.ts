export type PtyInstancePhase =
  | "spawning"
  | "trust-dialog"
  | "ready"
  | "streaming"
  | "cancelling"
  | "exited"

export type PtyInstanceSmokeTest = "pending" | "pass" | "fail"

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
}

export type PtyInstanceDelta =
  | { type: "added"; instance: PtyInstanceState }
  | { type: "updated"; instance: PtyInstanceState }
  | { type: "removed"; chatId: string }

export interface PtyInstancesSnapshot {
  instances: PtyInstanceState[]
}
