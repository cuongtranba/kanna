import {
  CLAUDE_IDLE_TIMEOUT_MS_MAX,
  CLAUDE_IDLE_TIMEOUT_MS_MIN,
  CLAUDE_MAX_CONCURRENT_MAX,
  CLAUDE_MAX_CONCURRENT_MIN,
  GLOBAL_PROMPT_APPEND_MAX_CHARS,
  OAUTH_TOKEN_MAX_CONCURRENT_MIN,
} from "../types"
import type { NumericBound } from "../numeric"

export const SHARE_DEFAULT_TTL_HOURS_BOUND = {
  path: "shareDefaultTtlHours",
  min: 1,
  max: Number.POSITIVE_INFINITY,
  integer: true,
} as const satisfies NumericBound

export const SUBAGENT_RUN_TIMEOUT_MS_DEFAULT = 600_000

export const SUBAGENT_RUN_TIMEOUT_MS_BOUND = {
  path: "subagentRuntime.runTimeoutMs",
  min: 30_000,
  max: 86_400_000,
  integer: true,
} as const satisfies NumericBound

export const CLAUDE_IDLE_TIMEOUT_MS_BOUND = {
  path: "claudeDriver.lifecycle.idleTimeoutMs",
  min: CLAUDE_IDLE_TIMEOUT_MS_MIN,
  max: CLAUDE_IDLE_TIMEOUT_MS_MAX,
  integer: false,
} as const satisfies NumericBound

export const CLAUDE_MAX_CONCURRENT_BOUND = {
  path: "claudeDriver.lifecycle.maxConcurrent",
  min: CLAUDE_MAX_CONCURRENT_MIN,
  max: CLAUDE_MAX_CONCURRENT_MAX,
  integer: false,
} as const satisfies NumericBound

export const OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND = {
  path: "claudeAuth.concurrencyDefault",
  min: OAUTH_TOKEN_MAX_CONCURRENT_MIN,
  max: Number.POSITIVE_INFINITY,
  integer: false,
} as const satisfies NumericBound

export const OAUTH_TOKEN_MAX_CONCURRENT_BOUND = {
  path: "claudeAuth.tokens entry maxConcurrent",
  min: OAUTH_TOKEN_MAX_CONCURRENT_MIN,
  max: Number.POSITIVE_INFINITY,
  integer: false,
} as const satisfies NumericBound

export function globalPromptAppendViolation<T>(text: T): string | null {
  if (typeof text !== "string") return "globalPromptAppend must be a string"
  return text.length > GLOBAL_PROMPT_APPEND_MAX_CHARS
    ? `globalPromptAppend must be ${GLOBAL_PROMPT_APPEND_MAX_CHARS} chars or fewer`
    : null
}
