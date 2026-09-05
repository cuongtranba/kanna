
export interface PerfAlertPayload {
  status: string
  alert: {
    alertname: string
    service_version?: string
    summary?: string
    description?: string
    runbook?: string
    code_hints?: string
    promql?: string
    threshold?: string
    ticket_scope?: string
  }
  instances: Array<{
    host?: string
    service?: string
    version?: string
    value?: string
    status?: string
  }>
  grafana_url?: string
}

export type CloseReason = "completed" | "not_planned"

export interface KnownIssue {
  number: number
  body: string
  updatedAt: number
  closed: { at: number; reason: CloseReason } | null
}

export type IssueAction =
  | { kind: "create"; title: string; body: string; labels: string[] }
  | { kind: "comment"; number: number; body: string }
  | { kind: "reopen"; number: number; body: string }
  | { kind: "close"; number: number; body: string }
  | {
    kind: "skip"
    reason:
      | "recently_updated"
      | "open_issue_cap"
      | "nothing_to_close"
      | "muted"
      | "condition_stays_open"
  }

export const MAX_OPEN_PERF_ISSUES = 10

export const QUIET_PERIOD_MS = 6 * 60 * 60 * 1000

export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function scopeOf(payload: PerfAlertPayload): "release" | "condition" {
  return payload.alert.ticket_scope === "condition" ? "condition" : "release"
}

export function alertMarker(payload: PerfAlertPayload): string {
  const { alertname } = payload.alert
  if (scopeOf(payload) === "condition") return `<!-- kanna-alert:${alertname} -->`
  const version = payload.alert.service_version || "unversioned"
  return `<!-- kanna-alert:${alertname}@${version} -->`
}

function instanceTable(payload: PerfAlertPayload): string {
  if (payload.instances.length === 0) return "_No instance detail in the notification._"
  const rows = payload.instances.map((instance) =>
    `| ${instance.service ?? "?"} | ${instance.host ?? "?"} | ${instance.version || "unversioned"} `
    + `| ${instance.value ?? "?"} |`)
  return ["| Service | Host | Version | Value |", "| --- | --- | --- | --- |", ...rows].join("\n")
}

function codeHintList(payload: PerfAlertPayload): string {
  const hints = (payload.alert.code_hints ?? "").split("\n").map((h) => h.trim()).filter(Boolean)
  return hints.length > 0 ? hints.map((h) => `- ${h}`).join("\n") : "_None recorded on the rule._"
}

function footer(scope: "release" | "condition"): string {
  if (scope === "condition") {
    return "_Filed automatically from a Grafana alert. This rule tracks an ongoing"
      + " condition rather than one release, so it stays open until a human closes"
      + " it — whether it is firing right now is in Grafana, not in this thread."
      + " **Close as not planned** to stop tracking this rule for good._"
  }
  return "_Filed automatically from a Grafana alert. Closes itself when the alert"
    + " resolves, and reopens here rather than filing a new ticket if it fires"
    + " again. **Close as not planned** to stop tracking this rule on this"
    + " release — e.g. when the fix has already shipped and the install"
    + " reporting it is simply out of date._"
}

export function renderIssue(payload: PerfAlertPayload): {
  title: string
  body: string
  labels: string[]
} {
  const { alert } = payload
  const version = alert.service_version || "unversioned"
  const scope = scopeOf(payload)
  const summary = alert.summary ?? alert.alertname
  return {
    title: scope === "condition" ? `perf: ${summary}` : `perf: ${summary} (${version})`,
    labels: ["performance", "agent-fix"],
    body: [
      alertMarker(payload),
      scope === "condition"
        ? `**${alert.alertname}** is firing. Every affected release is in the table below.`
        : `**${alert.alertname}** fired on Kanna \`${version}\`.`,
      "",
      alert.description ?? "",
      "",
      "## Affected installs",
      instanceTable(payload),
      "",
      "## What fired",
      "```promql",
      alert.promql ?? "",
      "```",
      `Threshold: \`${alert.threshold ?? "?"}\``,
      "",
      "## Where to start",
      codeHintList(payload),
      "",
      "## Runbook",
      alert.runbook ?? "",
      "",
      `Grafana: ${payload.grafana_url ?? "https://kanna-grafana.lowbit.link"}`,
      "",
      footer(scope),
    ].join("\n"),
  }
}

export function decideAction(
  payload: PerfAlertPayload,
  issues: readonly KnownIssue[],
  now: number,
): IssueAction {
  const marker = alertMarker(payload)
  const tracked = issues.filter((issue) => issue.body.includes(marker))
  const open = tracked.find((issue) => issue.closed === null)

  if (payload.status === "resolved") {
    if (scopeOf(payload) === "condition") {
      return { kind: "skip", reason: "condition_stays_open" }
    }
    if (!open) return { kind: "skip", reason: "nothing_to_close" }
    return {
      kind: "close",
      number: open.number,
      body: "Resolved: the alert stopped firing.",
    }
  }

  if (open) {
    if (now - open.updatedAt < QUIET_PERIOD_MS) {
      return { kind: "skip", reason: "recently_updated" }
    }
    return {
      kind: "comment",
      number: open.number,
      body: ["Still firing.", "", instanceTable(payload)].join("\n"),
    }
  }

  if (tracked.some((issue) => issue.closed?.reason === "not_planned")) {
    return { kind: "skip", reason: "muted" }
  }

  const settled = mostRecentlyClosed(tracked, now)
  if (settled) {
    return {
      kind: "reopen",
      number: settled.number,
      body: ["Firing again after this ticket closed.", "", instanceTable(payload)].join("\n"),
    }
  }

  const openCount = issues.filter((issue) => issue.closed === null).length
  if (openCount >= MAX_OPEN_PERF_ISSUES) {
    return { kind: "skip", reason: "open_issue_cap" }
  }
  return { ...renderIssue(payload), kind: "create" }
}

type ClosedIssue = KnownIssue & { closed: NonNullable<KnownIssue["closed"]> }

function mostRecentlyClosed(
  tracked: readonly KnownIssue[],
  now: number,
): ClosedIssue | undefined {
  return tracked
    .filter((issue): issue is ClosedIssue =>
      issue.closed !== null && now - issue.closed.at < REOPEN_WINDOW_MS)
    .sort((a, b) => b.closed.at - a.closed.at)[0]
}
