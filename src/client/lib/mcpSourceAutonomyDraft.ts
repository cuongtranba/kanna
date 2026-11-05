import {
  MCP_SOURCE_AUTONOMY_DEFAULTS,
  type InboxAutonomyLevel,
  type McpSourceAutonomy,
} from "../../shared/inbox/autonomy"

export interface McpSourceAutonomyDraft {
  autonomyLevel: InboxAutonomyLevel
  autonomyThreshold: string
  autonomyPerThreadPerHour: string
  autonomyPerSourcePerDay: string
  autonomyQuietStart: string
  autonomyQuietEnd: string
  autonomyAllowlist: string
  autonomyAllowUrls: boolean
  autonomyMaxChars: string
  autonomySendDelaySeconds: string
}

export function autonomyDraftFrom(autonomy: McpSourceAutonomy): McpSourceAutonomyDraft {
  return {
    autonomyLevel: autonomy.level,
    autonomyThreshold: String(autonomy.threshold),
    autonomyPerThreadPerHour: String(autonomy.perThreadPerHour),
    autonomyPerSourcePerDay: String(autonomy.perSourcePerDay),
    autonomyQuietStart: autonomy.quietHours?.start ?? "",
    autonomyQuietEnd: autonomy.quietHours?.end ?? "",
    autonomyAllowlist: autonomy.allowlist.join("\n"),
    autonomyAllowUrls: autonomy.allowUrls,
    autonomyMaxChars: String(autonomy.maxChars),
    autonomySendDelaySeconds: String(autonomy.sendDelaySeconds),
  }
}

export function emptyAutonomyDraft(): McpSourceAutonomyDraft {
  return autonomyDraftFrom(MCP_SOURCE_AUTONOMY_DEFAULTS)
}

interface NumberField {
  text: string
  label: string
  fallback: number
}

function numberOf(field: NumberField, errors: string[]): number {
  const text = field.text.trim()
  const value = Number(text)
  if (text.length > 0 && Number.isFinite(value)) return value
  errors.push(`${field.label} must be a number`)
  return field.fallback
}

function quietHoursOf(draft: McpSourceAutonomyDraft, errors: string[]): McpSourceAutonomy["quietHours"] {
  const start = draft.autonomyQuietStart.trim()
  const end = draft.autonomyQuietEnd.trim()
  if (start.length === 0 && end.length === 0) return null
  if (start.length === 0 || end.length === 0) {
    errors.push("Quiet hours need both a start and an end, or leave both empty")
    return null
  }
  return { start, end }
}

export function autonomyFromDraft(draft: McpSourceAutonomyDraft): { autonomy: McpSourceAutonomy; errors: string[] } {
  const defaults = MCP_SOURCE_AUTONOMY_DEFAULTS
  const errors: string[] = []
  const autonomy: McpSourceAutonomy = {
    level: draft.autonomyLevel,
    threshold: numberOf({ text: draft.autonomyThreshold, label: "Confidence threshold", fallback: defaults.threshold }, errors),
    perThreadPerHour: numberOf({ text: draft.autonomyPerThreadPerHour, label: "Per-thread hourly limit", fallback: defaults.perThreadPerHour }, errors),
    perSourcePerDay: numberOf({ text: draft.autonomyPerSourcePerDay, label: "Per-source daily limit", fallback: defaults.perSourcePerDay }, errors),
    quietHours: quietHoursOf(draft, errors),
    allowlist: draft.autonomyAllowlist.split("\n").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
    allowUrls: draft.autonomyAllowUrls,
    maxChars: numberOf({ text: draft.autonomyMaxChars, label: "Max characters", fallback: defaults.maxChars }, errors),
    sendDelaySeconds: numberOf({ text: draft.autonomySendDelaySeconds, label: "Send delay", fallback: defaults.sendDelaySeconds }, errors),
  }
  return { autonomy, errors }
}
