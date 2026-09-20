
import {
  COMPACTION_FINISHED,
  COMPACTION_POST_TOKENS,
  COMPACTION_PRE_TOKENS,
  COMPACTION_STARTED,
  HOST_MEMORY_TOTAL_BYTES,
  PACKAGE_APPLY_DURATION_MS,
  PACKAGE_APPLY_FINISHED,
  PACKAGE_CHECK_DURATION_MS,
  PACKAGE_CHECK_FINISHED,
  PACKAGE_UPDATE_RATE_LIMITED,
  PROCESS_MEMORY_CEILING_BYTES,
  PROCESS_RSS_BYTES,
  PROCESS_RSS_RATIO,
  SUBAGENT_RUN_FINISHED,
  SUBAGENT_RUN_DURATION_MS,
  SUBAGENT_TOKENS,
  TURN_COST_USD,
  TURN_DURATION_MS,
  TURN_TOKENS,
} from "../../server/observability"
import { TICKET_SCOPE_ANNOTATION } from "./webhook-payload"

export function promMetricName(otelName: string): string {
  return otelName.replaceAll(".", "_")
}

const rss = promMetricName(PROCESS_RSS_BYTES)
const rssRatio = promMetricName(PROCESS_RSS_RATIO)
const subagentRuns = `${promMetricName(SUBAGENT_RUN_FINISHED)}_total`
const turnDuration = promMetricName(TURN_DURATION_MS)
const subagentDuration = promMetricName(SUBAGENT_RUN_DURATION_MS)

export const EXPORTED_PROM_METRICS: readonly string[] = [
  rss,
  rssRatio,
  promMetricName(HOST_MEMORY_TOTAL_BYTES),
  promMetricName(PROCESS_MEMORY_CEILING_BYTES),
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
  `${promMetricName(COMPACTION_STARTED)}_total`,
  `${promMetricName(COMPACTION_FINISHED)}_total`,
  ...[promMetricName(COMPACTION_PRE_TOKENS), promMetricName(COMPACTION_POST_TOKENS)].flatMap((base) => [
    `${base}_bucket`,
    `${base}_count`,
    `${base}_sum`,
  ]),
]

export type TicketScope = "release" | "condition"

export interface AlertRuleSpec {
  uid: string
  title: string
  ticketScope: TicketScope
  promql: string
  threshold: number
  forDuration: string
  severity: "warning" | "critical"
  summary: string
  description: string
  runbook: string
  codeHints: string[]
  armed: boolean
  baselineNote?: string
}

const MIB = 1024 * 1024

const MIN_MEANINGFUL_RSS_BYTES = 256 * MIB

const SELF_COMPARISON_OFFSET = "3d"

export const ALERT_RULES: readonly AlertRuleSpec[] = [
  {
    uid: "kanna-perf-memory",
    title: "KannaMemoryPressure",
    ticketScope: "condition",
    promql: `avg_over_time(${rssRatio}[15m])`,
    threshold: 0.9,
    forDuration: "10m",
    severity: "critical",
    summary: "Kanna RSS is close to this machine's own memory ceiling",
    description:
      "Resident memory has averaged over 90% of this install's effective memory"
      + " ceiling for 25 minutes. The ceiling is computed per install as the"
      + " lower of the pm2 restart clamp (2 GiB, which pm2 will not exceed"
      + " whatever max_memory_restart says) and 80% of the machine's own RAM, so"
      + " a small laptop trips earlier than a large workstation instead of both"
      + " being judged against one hardcoded number. A breach restarts the"
      + " server, which cancels every in-flight turn and writes an `interrupted`"
      + " entry indistinguishable from a user Stop.",
    runbook:
      "Read kanna_process_memory_ceiling_bytes and kanna_host_memory_total_bytes"
      + " for the affected install to see which bound applies, then send SIGUSR2"
      + " to that process to write a heap snapshot under"
      + " <dataDir>/heap-snapshots and open it in Chrome DevTools' Memory tab"
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
    uid: "kanna-perf-memory-growth",
    title: "KannaMemoryGrowthPerInstall",
    ticketScope: "release",
    promql:
      `(avg by (job, service_name, host_name, service_version) (avg_over_time(${rss}[6h]))`
      + ` / on (job) group_left()`
      + ` avg by (job) (avg_over_time(${rss}[6h] offset ${SELF_COMPARISON_OFFSET})))`
      + ` and on (job) (avg by (job) (avg_over_time(${rss}[6h])) >= ${MIN_MEANINGFUL_RSS_BYTES})`,
    threshold: 1.3,
    forDuration: "60m",
    severity: "warning",
    summary: "An install is using materially more memory than it used to",
    description:
      "One install's average RSS is at least 30% above what the SAME install"
      + " averaged three days earlier, sustained for an hour, on a process"
      + " already using at least 256 MiB. Comparing an install against itself is"
      + " what makes the number mean something: machine power, RAM and corpus"
      + " size cancel out, where a ratio between different installs measures"
      + " whose computer is bigger. Note this fires on genuine workload growth"
      + " too — a user opening a much larger project — so confirm the version"
      + " changed before reading it as a release regression.",
    runbook:
      "Check whether the install's service_version changed inside the window."
      + " If it did, diff the releases; if it did not, the growth is workload or"
      + " a leak on a single install and the heap snapshot is the next step.",
    codeHints: [
      "git log --oneline <previous-version>..<current-version> — diff the releases; look for new getMessages() calls on hot paths (every turn / every loop iteration / every subagent spawn)",
      "src/server/event-store-messages.adapter.ts — TranscriptCache: evict() now drops even the sole entry when it exceeds maxBytes; if a cold getRecentMessagesPage is still doing a full load, check whether readTranscriptTail returned null (storage lacks slice APIs)",
      "src/server/subagent-orchestrator.ts — subagent primer path: full-transcript scope uses getRecentRawEntries (tail read); any reversion to getMessages() here costs ~524 MB peak per spawn on a 96 MB transcript",
      "src/server/claude-turn-starter.ts — history primer: loadExistingMessages thunk must call getRecentRawEntries, not getMessages; fires on every loop iteration (session token cleared by deliverSubagentToMain)",
    ],
    armed: false,
    baselineNote:
      "Replaces KannaMemoryReleaseRegression, which divided each release's"
      + " fleet-average RSS by the LIGHTEST install in the fleet and therefore"
      + " filed one ticket per release — 16 of them, with recorded ratios of"
      + " 4.83x (#1121) and 13.66x (#1107) that are hardware differences rather"
      + " than code. The self-comparison shape has no history yet, so observe a"
      + " week of this ratio per install before arming and set the threshold"
      + " from what a healthy upgrade actually costs.",
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
    uid: "kanna-perf-latency-growth",
    title: "KannaTurnLatencyGrowthPerInstall",
    ticketScope: "release",
    promql:
      `(histogram_quantile(0.95, sum by (job, service_name, host_name, service_version, le)`
      + ` (rate(${turnDuration}_bucket[6h])))`
      + ` / on (job) group_left()`
      + ` histogram_quantile(0.95, sum by (job, le)`
      + ` (rate(${turnDuration}_bucket[6h] offset ${SELF_COMPARISON_OFFSET}))))`
      + ` and on (job) (sum by (job) (increase(${turnDuration}_count[6h])) >= 50)`,
    threshold: 1.5,
    forDuration: "60m",
    severity: "warning",
    summary: "An install's turns are materially slower than they used to be",
    description:
      "One install's p95 turn latency is at least 50% above what the SAME"
      + " install measured three days earlier, over at least 50 turns. Turn"
      + " duration includes spawn cost, so it tracks machine speed as much as"
      + " code — comparing installs against each other would report the slowest"
      + " laptop in the fleet rather than a regression.",
    runbook:
      "Check whether the install's service_version changed inside the window,"
      + " then compare against the kanna.turn.start span in Tempo: latency in the"
      + " span is spawn cost, latency outside it is the model or the stream.",
    codeHints: [
      "git log --oneline <previous-version>..<current-version>",
      "src/server/claude-turn-starter.ts — startTurnForChat, the measured span",
    ],
    armed: false,
    baselineNote:
      "Needs kanna.turn.duration_ms present for a given install on both sides of"
      + " the 3d offset before the ratio means anything. Arm once one install has"
      + " reported turn durations continuously for more than three days.",
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
        [TICKET_SCOPE_ANNOTATION]: spec.ticketScope,
      },
      isPaused: !spec.armed,
    })),
  }
}
