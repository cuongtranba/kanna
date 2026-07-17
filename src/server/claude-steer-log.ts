import { log } from "../shared/log"
import type { AgentProvider, ModelOptions } from "../shared/types"

// ---------------------------------------------------------------------------
// Steer-logging and send-to-starting profiling helpers
// Extracted from agent.ts — pure env/math utilities, no AgentCoordinator dep.
// ---------------------------------------------------------------------------

export interface SendToStartingProfile {
  traceId: string
  startedAt: number
}

export function isClaudeSteerLoggingEnabled() {
  return process.env.KANNA_LOG_CLAUDE_STEER === "1"
}

export function logClaudeSteer(stage: string, details?: Record<string, unknown>) {
  if (!isClaudeSteerLoggingEnabled()) return
  log.info("[kanna/claude-steer]", JSON.stringify({
    stage,
    ...details,
  }))
}

export interface SendMessageOptions {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  effort?: string
  planMode?: boolean
  autoContinue?: { scheduleId: string }
}

export function isSendToStartingProfilingEnabled() {
  return process.env.KANNA_PROFILE_SEND_TO_STARTING === "1"
}

export function elapsedProfileMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(1))
}

export function logSendToStartingProfile(
  profile: SendToStartingProfile | null | undefined,
  stage: string,
  details?: Record<string, unknown>
) {
  if (!profile || !isSendToStartingProfilingEnabled()) {
    return
  }

  log.info("[kanna/send->starting][server]", JSON.stringify({
    traceId: profile.traceId,
    stage,
    elapsedMs: elapsedProfileMs(profile.startedAt),
    ...details,
  }))
}
