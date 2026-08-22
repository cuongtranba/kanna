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
  PROCESS_RSS_BYTES,
  SUBAGENT_RUN_FINISHED,
  SUBAGENT_RUN_DURATION_MS,
  TURN_DURATION_MS,
} from "../../server/observability"

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
  ...[turnDuration, subagentDuration].flatMap((base) => [
    `${base}_bucket`,
    `${base}_count`,
    `${base}_sum`,
  ]),
]

export interface AlertRuleSpec {
  /** Stable across re-applies, so a rule is updated rather than duplicated. */
  uid: string
  /** Becomes the `alertname` label, and half of a ticket's dedup fingerprint. */
  title: string
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
      "src/server/claude-turn-starter.ts — history primer now uses getRecentRawEntries (tail-read, PRIMER_TAIL_LIMIT=1000) instead of getMessages, eliminating per-loop-iteration full transcript loads",
      "src/server/event-store-subagent.ts — subagentRunsByChatId capped at MAX_SUBAGENT_RUNS_PER_CHAT (200) settled runs; entries[] per run capped at MAX_SUBAGENT_ENTRIES_PER_RUN (2000), oldest dropped first",
    ],
    armed: true,
  },
  {
    uid: "kanna-perf-subagent-failures",
    title: "KannaSubagentFailureRate",
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
      "src/server/event-store-messages.adapter.ts — TranscriptCache: evict() has a size>1 guard (last entry is never dropped); appendTo() grows entries past maxBytes (next getMessages() loads from disk at 5.4x amplification)",
      "src/server/subagent-orchestrator.ts — subagent primer path: full-transcript scope uses getRecentRawEntries (tail read); any reversion to getMessages() here costs ~524 MB peak per spawn on a 96 MB transcript",
      "src/server/claude-turn-starter.ts — history primer: loadExistingMessages thunk must call getRecentRawEntries, not getMessages; fires on every loop iteration (session token cleared by deliverSubagentToMain)",
    ],
    armed: true,
  },
  {
    uid: "kanna-perf-turn-latency",
    title: "KannaTurnLatencyHigh",
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
      },
      isPaused: !spec.armed,
    })),
  }
}
