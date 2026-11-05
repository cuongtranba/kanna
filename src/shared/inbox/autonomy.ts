import type { AgentProvider } from "../core-types"
import { clampRounded } from "../numeric"
import { oneOf } from "../vocab"
import { INBOX_REPLY_MAX_CHARS } from "./types"

export const INBOX_AUTONOMY_LEVELS = ["off", "suggest", "approve", "auto"] as const
export type InboxAutonomyLevel = (typeof INBOX_AUTONOMY_LEVELS)[number]
export const isInboxAutonomyLevel = oneOf(INBOX_AUTONOMY_LEVELS)

export interface McpSourceQuietHours {
  start: string
  end: string
}

export interface McpSourceAutonomy {
  level: InboxAutonomyLevel
  threshold: number
  perThreadPerHour: number
  perSourcePerDay: number
  quietHours: McpSourceQuietHours | null
  allowlist: string[]
  allowUrls: boolean
  maxChars: number
  sendDelaySeconds: number
}

export const MCP_SOURCE_AUTONOMY_DEFAULTS: McpSourceAutonomy = {
  level: "suggest",
  threshold: 0.8,
  perThreadPerHour: 3,
  perSourcePerDay: 20,
  quietHours: null,
  allowlist: [],
  allowUrls: false,
  maxChars: 1000,
  sendDelaySeconds: 30,
}

export const MCP_SOURCE_AUTONOMY_BOUNDS = {
  perThreadPerHour: { min: 0, max: 100 },
  perSourcePerDay: { min: 0, max: 1000 },
  maxChars: { min: 1, max: INBOX_REPLY_MAX_CHARS },
  sendDelaySeconds: { min: 10, max: 300 },
  allowlistEntries: 500,
  allowlistEntryChars: 200,
} as const

export const INBOX_TAKEOVER_PAUSE_MS = 30 * 60 * 1000
export const INBOX_PROPOSAL_REASON_MAX_CHARS = 300

const QUIET_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutesOf(time: string): number | null {
  const match = QUIET_TIME.exec(time)
  return match === null ? null : Number(match[1]) * 60 + Number(match[2])
}

export function isQuietTime(value: string): boolean {
  return minutesOf(value) !== null
}

export function isWithinQuietHours(quiet: McpSourceQuietHours | null, minuteOfDay: number): boolean {
  if (quiet === null) return false
  const start = minutesOf(quiet.start)
  const end = minutesOf(quiet.end)
  if (start === null || end === null || start === end) return false
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end
}

export function autonomyNeedsReplyTarget(level: InboxAutonomyLevel): boolean {
  return INBOX_AUTONOMY_LEVELS.indexOf(level) > INBOX_AUTONOMY_LEVELS.indexOf("suggest")
}

export function providerAllowsAuto(provider: AgentProvider | undefined): boolean {
  return provider !== "codex"
}

function clampThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MCP_SOURCE_AUTONOMY_DEFAULTS.threshold
  return Math.min(1, Math.max(0, value))
}

function cleanAllowlist(entries: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  for (const entry of entries ?? []) {
    const trimmed = entry.trim().slice(0, MCP_SOURCE_AUTONOMY_BOUNDS.allowlistEntryChars)
    if (trimmed.length > 0) seen.add(trimmed)
  }
  return [...seen].slice(0, MCP_SOURCE_AUTONOMY_BOUNDS.allowlistEntries)
}

export function normalizeMcpSourceAutonomy(input: Partial<McpSourceAutonomy> | undefined): McpSourceAutonomy {
  const defaults = MCP_SOURCE_AUTONOMY_DEFAULTS
  const bounds = MCP_SOURCE_AUTONOMY_BOUNDS
  const quiet = input?.quietHours
  return {
    level: input?.level ?? defaults.level,
    threshold: clampThreshold(input?.threshold),
    perThreadPerHour: clampRounded(input?.perThreadPerHour, bounds.perThreadPerHour, defaults.perThreadPerHour),
    perSourcePerDay: clampRounded(input?.perSourcePerDay, bounds.perSourcePerDay, defaults.perSourcePerDay),
    quietHours: quiet ? { start: quiet.start.trim(), end: quiet.end.trim() } : null,
    allowlist: cleanAllowlist(input?.allowlist),
    allowUrls: input?.allowUrls ?? defaults.allowUrls,
    maxChars: clampRounded(input?.maxChars, bounds.maxChars, defaults.maxChars),
    sendDelaySeconds: clampRounded(input?.sendDelaySeconds, bounds.sendDelaySeconds, defaults.sendDelaySeconds),
  }
}

export function validateMcpSourceAutonomy(autonomy: Partial<McpSourceAutonomy> | undefined, hasReply: boolean): string[] {
  if (autonomy === undefined) return []
  const normalized = normalizeMcpSourceAutonomy(autonomy)
  const errors: string[] = []
  if (autonomyNeedsReplyTarget(normalized.level) && !hasReply) {
    errors.push("Approve and Auto autonomy need a reply target")
  }
  const quiet = normalized.quietHours
  if (quiet !== null && (!isQuietTime(quiet.start) || !isQuietTime(quiet.end))) {
    errors.push("Quiet hours must be HH:MM times")
  }
  return errors
}
