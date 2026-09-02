/**
 * The fleet's performance alert rules, and the Grafana payload they compile to.
 *
 * The spec table below is the interface: a rule is a query, a number, and the
 * context its ticket needs. Grafana's own rule model — refIds, expression
 * nodes, evaluator params — is implementation detail hidden by buildRuleGroup,
 * because hand-writing it per rule is how thresholds and queries drift apart.
 *
 * Pure: applying these is `scripts/grafana-alerts.ts`.
 */

import {
  PACKAGE_APPLY_DURATION_MS,
  PACKAGE_APPLY_FINISHED,
  PACKAGE_CHECK_DURATION_MS,
  PACKAGE_CHECK_FINISHED,
  PACKAGE_UPDATE_RATE_LIMITED,
  PROCESS_RSS_BYTES,
  SUBAGENT_RUN_FINISHED,
  SUBAGENT_RUN_DURATION_MS,
  SUBAGENT_TOKENS,
  TURN_COST_USD,
  TURN_DURATION_MS,
  TURN_TOKENS,
} from "../../server/observability"
import { TICKET_SCOPE_ANNOTATION } from "./webhook-payload"

/** How the OTLP collector mangles an instrument name into a Prometheus one. */
export function promMetricName(otelName: string): string {
  return otelName.replaceAll(".", "_")
}

const rss = promMetricName(PROCESS_RSS_BYTES)
const subagentRuns = `${promMetricName(SUBAGENT_RUN_FINISHED)}_total`
const turnDuration = promMetricName(TURN_DURATION_MS)
const subagentDuration = promMetricName(SUBAGENT_RUN_DURATION_MS)

/**
 * Every Prometheus series name Kanna produces. A rule may reference nothing
 * else — a query naming a metric that does not exist selects no series and
 * therefore never fires, which is indistinguishable from "all is well".
 */
export const EXPORTED_PROM_METRICS: readonly string[] = [
  rss,
  "kanna_process_heap_used_bytes",
  "kanna_process_heap_total_bytes",
  "kanna_process_external_bytes",
  subagentRuns,
  "kanna_autocontinue_fired_total",
  "kanna_queued_message_recovered_total",
  "kanna_loop_wake_recovered_total",
  `${promMetricName(TURN_TOKENS)}_total`,
  `${promMetricName(TURN_COST_USD)}_total`,
  `${promMetricName(SUBAGENT_TOKENS)}_total`,
  ...[turnDuration, subagentDuration].flatMap((base) => [
    `${base}_bucket`,
    `${base}_count`,
    `${base}_sum`,
  ]),
  `${promMetricName(PACKAGE_CHECK_FINISHED)}_total`,
  `${promMetricName(PACKAGE_APPLY_FINISHED)}_total`,
  `${promMetricName(PACKAGE_UPDATE_RATE_LIMITED)}_total`,
  ...[promMetricName(PACKAGE_CHECK_DURATION_MS), promMetricName(PACKAGE_APPLY_DURATION_MS)].flatMap((base) => [
    `${base}_bucket`,
    `${base}_count`,
    `${base}_sum`,
  ]),
]

/**
 * What a ticket for this rule is ABOUT — which decides how it is deduplicated
 * and what a resolve means. It is one field rather than two flags because the
 * two questions have one answer: a ticket is settled by the same thing that
 * identifies it.
 *
 * - `release` — the rule compares releases to each other, so the release IS the
 *   subject. Keyed per version, and a resolve closes it: that version has been
 *   judged, and it never ships again.
 * - `condition` — the rule is an absolute threshold on an install's health. The
 *   version is incidental; the condition survives the upgrade. Keyed on the
 *   rule alone, and a resolve leaves the ticket open, because a dip back under
 *   the threshold is not the work being done.
 *
 * Getting this wrong is not a small mistake. Kanna cuts releases several times
 * a day, so scoping a condition per release mints a fresh ticket per deploy for
 * one continuous problem — and makes the operator's only mute expire with it.
 */
export type TicketScope = "release" | "condition"

export interface AlertRuleSpec {
  /** Stable across re-applies, so a rule is updated rather than duplicated. */
  uid: string
  /**
   * Becomes the `alertname` label, and the ticket's dedup fingerprint. The
   * ticket pipeline resolves a rule's scope by this string — see ticketScopeOf.
   */
  title: string
  ticketScope: TicketScope
  /** Evaluated instant; the rule fires when the result exceeds `threshold`. */
  promql: string
  threshold: number
  /** How long the breach must persist, e.g. "15m". */
  forDuration: string
  severity: "warning" | "critical"
  summary: string
  description: string
  runbook: string
  /** Where an agent should start reading. Rendered into the ticket body. */
  codeHints: string[]
  /** False applies the rule paused — defined and reviewable, but not firing. */
  armed: boolean
  /** Required when not armed: what must be measured before choosing a number. */
  baselineNote?: string
}

const MIB = 1024 * 1024

export const ALERT_RULES: readonly AlertRuleSpec[] = [
  {
    uid: "kanna-perf-memory",
    title: "KannaMemoryPressure",
    // An install sitting over the ceiling stays over it across an upgrade, so
    // the ticket is about the condition; every affected release is listed in
    // its instance table.
    ticketScope: "condition",
    // Instance-level on purpose: the notification groups by version, so the
    // ticket can still name every host that breached.
    promql: `avg_over_time(${rss}[15m])`,
    threshold: 1800 * MIB,
    forDuration: "10m",
    severity: "critical",
    summary: "Kanna RSS is close to the pm2 restart ceiling",
    description:
      "Resident memory has averaged over 1.8 GiB for 25 minutes. pm2 clamps"
      + " max_memory_restart at 2 GiB, and a breach restarts the server, which"
      + " cancels every in-flight turn and writes an `interrupted` entry"
      + " indistinguishable from a user Stop.",
    runbook:
      "Send SIGUSR2 to the affected process to write a heap snapshot under"
      + " <dataDir>/heap-snapshots, then open it in Chrome DevTools' Memory tab"
      + " to see what holds the bytes.",
    codeHints: [
      "src/server/event-store-messages.adapter.ts — TranscriptCache: transcripts larger than maxBytes are never cached; each re-read of a large transcript (e.g., 96 MB → 524 MB peak RSS) spikes on parse",
      "src/server/event-store-messages.adapter.ts — loadTranscriptWithBytes: whole-file loads with a deep clone; search callers of store.getMessages() for new full-load sites",
      "src/server/auto-continue/compact-loop-wakes.ts — compactLoopWakeEvents now also trims superseded loop_armed events (each carries the full ~5 KB loop prompt); check if the fix landed in this version",
      "src/server/event-store-subagent.ts — subagentRunsByChatId capped at MAX_SUBAGENT_RUNS_PER_CHAT (200) settled runs; entries[] per run capped at MAX_SUBAGENT_ENTRIES_PER_RUN (2000), oldest dropped first",
    ],
    armed: true,
  },
  {
    uid: "kanna-perf-subagent-failures",
    title: "KannaSubagentFailureRate",
    ticketScope: "condition",
    // The volume guard is not defensive trimming: at fleet volumes seen today
    // (single-digit runs per day) one failure is 20% and means nothing.
    promql:
      `(sum by (service_version) (rate(${subagentRuns}{outcome!="completed"}[6h]))`
      + ` / sum by (service_version) (rate(${subagentRuns}[6h])))`
      + ` and on (service_version)`
      + ` (sum by (service_version) (increase(${subagentRuns}[6h])) >= 10)`,
    threshold: 0.3,
    forDuration: "30m",
    severity: "warning",
    summary: "Delegated subagent runs are failing at an elevated rate",
    description:
      "More than 30% of subagent runs in the last 6 hours ended in a non-completed"
      + " outcome, across at least 10 runs. Every autonomous loop iteration is a"
      + " subagent run, so a sustained failure rate stalls loops rather than"
      + " merely degrading them.",
    runbook:
      "Break the rate down by the `outcome` label in Grafana Explore; AUTH_REQUIRED"
      + " points at the OAuth pool, MAX_TURNS at per-subagent caps, PROVIDER_ERROR"
      + " at the driver.",
    codeHints: [
      "src/server/subagent-orchestrator.ts — spawnRun, failRun, the permit pool",
      "src/server/provider-catalog.ts — claudeAuthReady, the spawn gate",
      "src/server/subagent-provider-run.ts — per-provider run start",
    ],
    armed: true,
  },
  {
    uid: "kanna-perf-memory-regression",
    title: "KannaMemoryReleaseRegression",
    ticketScope: "release",
    // scalar(min(...)) makes this self-guarding: with one version live the
    // ratio is exactly 1 and the rule cannot fire. The count guard keeps a
    // single unusual install from defining a version's average.
    promql:
      `(avg by (service_version) (avg_over_time(${rss}[6h]))`
      + ` / scalar(min(avg by (service_version) (avg_over_time(${rss}[6h])))))`
      + ` and on (service_version) (count by (service_version) (${rss}) >= 2)`,
    threshold: 1.3,
    forDuration: "60m",
    severity: "warning",
    summary: "One release uses materially more memory than the best release",
    description:
      "A service_version's fleet-average RSS is at least 30% above the leanest"
      + " version currently reporting, sustained for an hour over at least two"
      + " installs. That shape — same workload, different version — is what"
      + " separates a regression from one user's heavy project.",
    runbook:
      "Compare the two versions in Grafana, then diff the releases. The"
      + " regression is in what changed between them, not in whatever is"
      + " largest in the heap snapshot.",
    codeHints: [
      "git log --oneline <lean-version>..<regressed-version> — diff the releases; look for new getMessages() calls on hot paths (every turn / every loop iteration / every subagent spawn)",
      "src/server/event-store-messages.adapter.ts — TranscriptCache: evict() now drops even the sole entry when it exceeds maxBytes; if a cold getRecentMessagesPage is still doing a full load, check whether readTranscriptTail returned null (storage lacks slice APIs)",
      "src/server/subagent-orchestrator.ts — subagent primer path: full-transcript scope uses getRecentRawEntries (tail read); any reversion to getMessages() here costs ~524 MB peak per spawn on a 96 MB transcript",
      "src/server/claude-turn-starter.ts — history primer: loadExistingMessages thunk must call getRecentRawEntries, not getMessages; fires on every loop iteration (session token cleared by deliverSubagentToMain)",
    ],
    armed: true,
  },
  {
    uid: "kanna-perf-turn-latency",
    title: "KannaTurnLatencyHigh",
    ticketScope: "condition",
    promql:
      `histogram_quantile(0.95, sum by (service_version, le) (rate(${turnDuration}_bucket[30m])))`
      + ` and on (service_version)`
      + ` (sum by (service_version) (increase(${turnDuration}_count[30m])) >= 20)`,
    threshold: 600_000,
    forDuration: "30m",
    severity: "warning",
    summary: "p95 turn latency is far above what a turn should take",
    description:
      "The 95th percentile of end-to-end turn duration exceeded 10 minutes over"
      + " a 30-minute window with at least 20 turns.",
    runbook:
      "Compare against the kanna.turn.start span in Tempo: latency in the span"
      + " is spawn cost, latency outside it is the model or the stream.",
    codeHints: [
      "src/server/claude-turn-starter.ts — the spawn pipeline",
      "src/server/claude-session-runner.ts — stream consumption and terminal handling",
    ],
    armed: false,
    baselineNote:
      "kanna.turn.duration_ms ships with this change and has no history."
      + " Observe a week of p95 per version, then set the threshold from what a"
      + " healthy fleet actually does. 10 minutes is a placeholder chosen to be"
      + " obviously-bad, not a measured bound.",
  },
  {
    uid: "kanna-perf-latency-regression",
    title: "KannaTurnLatencyReleaseRegression",
    ticketScope: "release",
    promql:
      `(histogram_quantile(0.95, sum by (service_version, le) (rate(${turnDuration}_bucket[6h])))`
      + ` / scalar(min(histogram_quantile(0.95,`
      + ` sum by (service_version, le) (rate(${turnDuration}_bucket[6h]))))))`
      + ` and on (service_version)`
      + ` (sum by (service_version) (increase(${turnDuration}_count[6h])) >= 50)`,
    threshold: 1.5,
    forDuration: "60m",
    severity: "warning",
    summary: "One release is materially slower than the best release",
    description:
      "A service_version's p95 turn latency is at least 50% above the fastest"
      + " version currently reporting, over at least 50 turns.",
    runbook: "Diff the two releases; the regression is in what changed between them.",
    codeHints: [
      "git log --oneline <fast-version>..<slow-version>",
      "src/server/claude-turn-starter.ts — startTurnForChat, the measured span",
    ],
    armed: false,
    baselineNote:
      "Needs kanna.turn.duration_ms present on at least two releases before the"
      + " ratio means anything. Arm once a second version has reported for a day.",
  },
]

export interface GrafanaQueryNode {
  refId: string
  datasourceUid: string
  relativeTimeRange?: { from: number; to: number }
  model: {
    refId: string
    expr?: string
    instant?: boolean
    type?: string
    expression?: string
    conditions?: Array<{ evaluator: { type: string; params: number[] } }>
  }
}

export interface GrafanaAlertRule {
  uid: string
  title: string
  condition: string
  data: GrafanaQueryNode[]
  noDataState: "OK"
  execErrState: "OK"
  for: string
  labels: Record<string, string>
  annotations: Record<string, string>
  isPaused: boolean
  orgID: number
  folderUID: string
  ruleGroup: string
}

export interface GrafanaRuleGroup {
  title: string
  /** Evaluation interval in SECONDS. Grafana rejects a duration string here. */
  interval: number
  rules: GrafanaAlertRule[]
  folderUid: string
}

export const RULE_GROUP_TITLE = "kanna-performance"

export function buildRuleGroup(
  specs: readonly AlertRuleSpec[],
  target: { folderUid: string; datasourceUid: string },
): GrafanaRuleGroup {
  return {
    title: RULE_GROUP_TITLE,
    interval: 300,
    folderUid: target.folderUid,
    rules: specs.map((spec) => ({
      uid: spec.uid,
      title: spec.title,
      orgID: 1,
      folderUID: target.folderUid,
      ruleGroup: RULE_GROUP_TITLE,
      condition: "C",
      data: [
        {
          refId: "A",
          datasourceUid: target.datasourceUid,
          relativeTimeRange: { from: 21600, to: 0 },
          model: { refId: "A", expr: spec.promql, instant: true },
        },
        {
          refId: "C",
          datasourceUid: "__expr__",
          model: {
            refId: "C",
            type: "threshold",
            expression: "A",
            conditions: [{ evaluator: { type: "gt", params: [spec.threshold] } }],
          },
        },
      ],
      // An install that goes quiet is not a regression, and every laptop in the
      // fleet goes quiet nightly. A broken query must not ticket either — the
      // rules suite is what catches those.
      noDataState: "OK",
      execErrState: "OK",
      for: spec.forDuration,
      labels: { kanna_alert: "perf", severity: spec.severity },
      annotations: {
        summary: spec.summary,
        description: spec.description,
        runbook: spec.runbook,
        code_hints: spec.codeHints.join("\n"),
        promql: spec.promql,
        threshold: String(spec.threshold),
        // Rides the wire rather than being looked up from this table, because
        // the workflow that files the ticket runs with no node_modules — see
        // TICKET_SCOPE_ANNOTATION.
        [TICKET_SCOPE_ANNOTATION]: spec.ticketScope,
      },
      isPaused: !spec.armed,
    })),
  }
}
