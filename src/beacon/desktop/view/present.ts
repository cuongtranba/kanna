import type { StatusTone } from "../../../client/lib/statusLabel"
import type { BeaconScope } from "../../../shared/beacon-scope"
import type { BeaconActivity, BeaconActivityOutcome } from "../../activity"
import type { BeaconRunnerSnapshot } from "../../runner"
import type { DesktopLocale, DesktopStrings } from "../strings"

export interface PresentedStatus {
  tone: StatusTone
  label: string
  detail: string
}

export function formatClock(at: number, locale: DesktopLocale): string {
  return new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })
}

export function presentStatus(
  snapshot: BeaconRunnerSnapshot,
  strings: DesktopStrings,
  now: number,
  locale: DesktopLocale,
): PresentedStatus {
  const { status } = snapshot
  switch (status.phase) {
    case "online":
      return { tone: "active", label: strings.status.online, detail: strings.status.onlineSince(formatClock(status.since, locale)) }
    case "connecting":
      return {
        tone: "attention",
        label: status.attempt > 1 ? strings.status.reconnecting : strings.status.connecting,
        detail: "",
      }
    case "offline":
      if (status.reason === "disabled") {
        return { tone: "muted", label: strings.status.switchedOff, detail: strings.status.switchedOffDetail }
      }
      return {
        tone: "attention",
        label: strings.status.offline,
        detail: strings.status.retryIn(Math.max(1, Math.ceil((status.retryAt - now) / 1000))),
      }
    case "paused":
      return { tone: "muted", label: strings.status.paused, detail: strings.status.pausedDetail }
    case "revoked":
      return { tone: "destructive", label: strings.status.revoked, detail: strings.status.revokedDetail }
    case "incompatible":
      return { tone: "destructive", label: strings.status.incompatible, detail: strings.status.incompatibleDetail }
    case "stopped":
      return { tone: "muted", label: strings.status.notPaired, detail: "" }
  }
}

export interface PresentedGrant {
  folders: readonly string[]
  commands: string
  approval: string
  approvalTone: StatusTone
}

export function presentGrant(scope: BeaconScope, strings: DesktopStrings): PresentedGrant {
  const { grantSummary } = strings
  return {
    folders: scope.readRoots,
    commands: scope.exec ? grantSummary.commandsOn : grantSummary.commandsOff,
    approval: scope.autoRunScripts ? grantSummary.approvalAuto : grantSummary.approvalAsk,
    approvalTone: scope.autoRunScripts ? "attention" : "muted",
  }
}

export function presentOutcome(outcome: BeaconActivityOutcome, strings: DesktopStrings): { tone: StatusTone; label: string } {
  switch (outcome.kind) {
    case "done":
      return { tone: "muted", label: strings.record.done }
    case "exit":
      return { tone: outcome.code === 0 ? "muted" : "attention", label: strings.record.exit(outcome.code) }
    case "failed":
      return { tone: "destructive", label: strings.record.failed }
    case "refused":
      return { tone: "destructive", label: strings.record.refused }
  }
}

export interface ActivityDay {
  key: string
  label: string
  entries: readonly BeaconActivity[]
}

function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function groupActivityByDay(
  entries: readonly BeaconActivity[],
  strings: DesktopStrings,
  now: number,
  locale: DesktopLocale,
): readonly ActivityDay[] {
  const today = dayKey(now)
  const yesterday = dayKey(now - 86_400_000)
  const dayLabel = (key: string, at: number): string => {
    if (key === today) return strings.record.today
    if (key === yesterday) return strings.record.yesterday
    return new Date(at).toLocaleDateString(locale, { day: "numeric", month: "long" })
  }
  const days: ActivityDay[] = []
  for (const entry of entries) {
    const key = dayKey(entry.at)
    const last = days[days.length - 1]
    if (last && last.key === key) {
      days[days.length - 1] = { ...last, entries: [...last.entries, entry] }
      continue
    }
    days.push({ key, label: dayLabel(key, entry.at), entries: [entry] })
  }
  return days
}

export function splitFolderPath(path: string): { name: string; parent: string } {
  const trimmed = path.length > 3 ? path.replace(/[\\/]+$/, "") : path
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"))
  if (index <= 0 || index === trimmed.length - 1) return { name: trimmed, parent: "" }
  const parent = trimmed.slice(0, index)
  return { name: trimmed.slice(index + 1), parent: /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent }
}
