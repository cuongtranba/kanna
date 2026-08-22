/**
 * Turns one Grafana alert notification into the GitHub issue an agent picks up.
 *
 * Pure: `scripts/perf-alert-issue.ts` supplies the open issues and performs the
 * write. Keeping the decision here is what makes "when does this open a second
 * ticket" a testable question rather than a property of a YAML file.
 *
 * Everything below turns on the rule's `TicketScope` — see `rules.ts`. A
 * release-scoped ticket is keyed per version and settled by that version
 * recovering; a condition-scoped one is keyed on the rule and settled only by a
 * human.
 *
 * This module imports NOTHING at runtime, and must not start doing so: the
 * workflow that runs it does not `bun install`. That is why the scope arrives
 * on the notification (see TICKET_SCOPE_ANNOTATION) rather than being looked up
 * from the rule table, which would drag in the whole observability stack.
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
    /** The rule's TicketScope. Absent on a notification from a Grafana state
     * applied before scopes existed — see `scopeOf`. */
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

/**
 * Why a ticket was closed. `not_planned` is GitHub's "Close as not planned",
 * which this pipeline reads as a permanent mute for whatever the ticket was
 * keyed on — see `decideAction`.
 */
export type CloseReason = "completed" | "not_planned"

export interface KnownIssue {
  number: number
  body: string
  /** Epoch ms of the issue's last activity, used to throttle repeat comments. */
  updatedAt: number
  /** Null while open; a closed ticket carries when it closed and why. */
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

/**
 * Bounds issue creation. The OTLP ingest endpoint is unauthenticated, so forged
 * metrics can reach this path; without a cap that is unbounded issue creation.
 * Counts OPEN tickets only — settled history must never wedge the pipeline shut.
 */
export const MAX_OPEN_PERF_ISSUES = 10

/** How long a ticket must sit untouched before a repeat firing comments again. */
export const QUIET_PERIOD_MS = 6 * 60 * 60 * 1000

/**
 * How long after closing a ticket a fresh breach is still the same episode.
 *
 * A release ticket auto-closes when its version recovers, so without this every
 * flap filed a new one: five identical KannaMemoryPressure tickets in five
 * hours. Past the window the cause is a genuinely new episode, and resurrecting
 * a months-old thread reads as noise rather than history.
 *
 * It bounds REOPENING only. A mute is not an episode and is never aged out —
 * running it through this window is what made a deliberate "stop tracking this"
 * expire after a week, silently, and start filing again.
 */
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The scope this notification's rule declares.
 *
 * Anything but an explicit `condition` reads as `release` — the shape every
 * ticket used before scopes existed. A notification from a Grafana state that
 * predates the annotation therefore keeps behaving exactly as it did, and a
 * garbled value degrades the same way rather than silently merging two rules'
 * tickets into one.
 */
function scopeOf(payload: PerfAlertPayload): "release" | "condition" {
  return payload.alert.ticket_scope === "condition" ? "condition" : "release"
}

/**
 * Dedup key, deliberately readable rather than hashed: a ticket filed against
 * the wrong group is diagnosed by reading this line.
 *
 * Both shapes close with " -->", so neither can substring-match the other: a
 * ticket filed under the old version-scoped key for a now-condition-scoped rule
 * is left alone rather than silently adopted.
 */
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

/**
 * The closing note. It is the only place the mute is documented — the gesture
 * is plain GitHub with nothing in the UI hinting it means anything here — and
 * for a condition ticket it is the ONLY way the ticket ever ends.
 */
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
    // A condition ticket outlives whichever release happened to be running when
    // it opened, so naming that release in the title would date it instantly.
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
    // A condition ticket tracks the fix, not the alert's instantaneous state.
    // Closing on a dip is what turned one ongoing problem into a stream of
    // open/close pairs — #863 lived five minutes. Grafana already shows whether
    // it is firing; only a human knows whether the work is done.
    if (scopeOf(payload) === "condition") {
      return { kind: "skip", reason: "condition_stays_open" }
    }
    // The cap is deliberately not consulted here: a storm that hit the cap must
    // still be able to close what it opened.
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

  // Checked before — and independently of — the reopen window, because the two
  // answer different questions. The window asks "is this the same episode"; a
  // mute asks "should this be tracked at all", and that decision does not age.
  // Aging it out is what made the documented off-switch expire after a week.
  if (tracked.some((issue) => issue.closed?.reason === "not_planned")) {
    return { kind: "skip", reason: "muted" }
  }

  const settled = mostRecentlyClosed(tracked, now)
  if (settled) {
    // The quiet period is not consulted: it throttles chatter on a ticket that
    // is already visible, and a closed one is not. Reopening is also exempt
    // from the cap — it is bounded by the markers already ticketed, so it is
    // not the unbounded-creation path the cap exists to stop.
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
