import { readIntEnv } from "./env-int"
import type { ClaudeSessionLifecycleOptions } from "./agent-coordinator-types"

export type RuntimeEnv = Readonly<Record<string, string | undefined>>

export interface AgentRuntimeConfig {
  cronRepairEnabled: boolean
  cronConfirmEnabled: boolean
  mermaidGuardEnabled: boolean
  subagentMaxLive: number | undefined
  subagentIdleTimeoutMs: number | undefined
  subagentRunTimeoutMs: number | undefined
  endpointFirstEntryTimeoutMs: number
  claudeSessionLifecycle: ClaudeSessionLifecycleOptions
}

const DEFAULT_CLAUDE_SESSION_IDLE_MS = 10 * 60 * 1000
const DEFAULT_CLAUDE_SESSION_MAX_RESIDENT = 4
const DEFAULT_CLAUDE_SESSION_SWEEP_INTERVAL_MS = 60 * 1000
const DEFAULT_CLAUDE_BACKGROUND_TASK_MAX_MS = 30 * 60 * 1000
const DEFAULT_BACKGROUND_TASK_MAX_WAKES = 3
const DEFAULT_ENDPOINT_FIRST_ENTRY_TIMEOUT_MS = 2 * 60 * 1000

function unsetWhenZero(value: string | undefined): number | undefined {
  return readIntEnv(value, 0) || undefined
}

export function resolveAgentRuntimeConfig(env: RuntimeEnv): AgentRuntimeConfig {
  return {
    cronRepairEnabled: env.KANNA_CRON_REPAIR !== "disabled",
    cronConfirmEnabled: env.KANNA_CRON_CONFIRM !== "disabled",
    mermaidGuardEnabled: env.KANNA_MERMAID_GUARD !== "disabled",
    subagentMaxLive: unsetWhenZero(env.KANNA_SUBAGENT_MAX_LIVE),
    subagentIdleTimeoutMs: unsetWhenZero(env.KANNA_SUBAGENT_IDLE_TIMEOUT_MS),
    subagentRunTimeoutMs: unsetWhenZero(env.KANNA_SUBAGENT_RUN_TIMEOUT_MS),
    endpointFirstEntryTimeoutMs: readIntEnv(
      env.KANNA_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS,
      DEFAULT_ENDPOINT_FIRST_ENTRY_TIMEOUT_MS,
    ),
    claudeSessionLifecycle: {
      idleMs: readIntEnv(env.KANNA_CLAUDE_SESSION_IDLE_MS, DEFAULT_CLAUDE_SESSION_IDLE_MS),
      maxResidentSessions: readIntEnv(
        env.KANNA_CLAUDE_SESSION_MAX_RESIDENT,
        DEFAULT_CLAUDE_SESSION_MAX_RESIDENT,
      ),
      sweepIntervalMs: readIntEnv(
        env.KANNA_CLAUDE_SESSION_SWEEP_INTERVAL_MS,
        DEFAULT_CLAUDE_SESSION_SWEEP_INTERVAL_MS,
      ),
      backgroundTaskMaxMs: readIntEnv(
        env.KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS,
        readIntEnv(env.KANNA_PTY_BACKGROUND_TASK_MAX_MS, DEFAULT_CLAUDE_BACKGROUND_TASK_MAX_MS),
      ),
      backgroundTaskMaxWakes: readIntEnv(
        env.KANNA_BACKGROUND_TASK_MAX_WAKES,
        DEFAULT_BACKGROUND_TASK_MAX_WAKES,
      ),
    },
  }
}

export const DEFAULT_AGENT_RUNTIME_CONFIG: AgentRuntimeConfig = resolveAgentRuntimeConfig({})
