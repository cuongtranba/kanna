/**
 * Turns one Grafana alert notification into the GitHub issue an agent picks up.
 *
 * Pure: `scripts/perf-alert-issue.ts` supplies the open issues and performs the
 * write. Keeping the decision here is what makes "when does this open a second
 * ticket" a testable question rather than a property of a YAML file.
 */

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

export interface OpenIssue {
  number: number
  body: string
  /** Epoch ms of the issue's last activity, used to throttle repeat comments. */
  updatedAt: number
}

export type IssueAction =
  | { kind: "create"; title: string; body: string; labels: string[] }
  | { kind: "comment"; number: number; body: string }
  | { kind: "close"; number: number; body: string }
  | { kind: "skip"; reason: "recently_updated" | "open_issue_cap" | "nothing_to_close" }

/**
 * Bounds issue creation. The OTLP ingest endpoint is unauthenticated, so forged
 * metrics can reach this path; without a cap that is unbounded issue creation.
 */
export const MAX_OPEN_PERF_ISSUES = 10

/** How long a ticket must sit untouched before a repeat firing comments again. */
export const QUIET_PERIOD_MS = 6 * 60 * 60 * 1000

/**
 * Dedup key, deliberately readable rather than hashed: a ticket filed against
 * the wrong group is diagnosed by reading this line.
 */
export function alertMarker(payload: PerfAlertPayload): string {
  const version = payload.alert.service_version || "unversioned"
  return `<!-- kanna-alert:${payload.alert.alertname}@${version} -->`
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

export function renderIssue(payload: PerfAlertPayload): {
  title: string
  body: string
  labels: string[]
} {
  const { alert } = payload
  const version = alert.service_version || "unversioned"
  return {
    title: `perf: ${alert.summary ?? alert.alertname} (${version})`,
    labels: ["performance", "agent-fix"],
    body: [
      alertMarker(payload),
      `**${alert.alertname}** fired on Kanna \`${version}\`.`,
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
      "_Filed automatically from a Grafana alert. Closes itself when the alert resolves._",
    ].join("\n"),
  }
}

export function decideAction(
  payload: PerfAlertPayload,
  openIssues: readonly OpenIssue[],
  now: number,
): IssueAction {
  const marker = alertMarker(payload)
  const tracked = openIssues.find((issue) => issue.body.includes(marker))
  const resolved = payload.status === "resolved"

  if (resolved) {
    // The cap is deliberately not consulted here: a storm that hit the cap must
    // still be able to close what it opened.
    if (!tracked) return { kind: "skip", reason: "nothing_to_close" }
    return {
      kind: "close",
      number: tracked.number,
      body: "Resolved: the alert stopped firing.",
    }
  }

  if (tracked) {
    if (now - tracked.updatedAt < QUIET_PERIOD_MS) {
      return { kind: "skip", reason: "recently_updated" }
    }
    return {
      kind: "comment",
      number: tracked.number,
      body: ["Still firing.", "", instanceTable(payload)].join("\n"),
    }
  }

  if (openIssues.length >= MAX_OPEN_PERF_ISSUES) {
    return { kind: "skip", reason: "open_issue_cap" }
  }
  return { ...renderIssue(payload), kind: "create" }
}
