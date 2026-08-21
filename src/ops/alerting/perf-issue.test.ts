import { describe, expect, test } from "bun:test"
import {
  MAX_OPEN_PERF_ISSUES,
  QUIET_PERIOD_MS,
  alertMarker,
  decideAction,
  renderIssue,
  type OpenIssue,
  type PerfAlertPayload,
} from "./perf-issue"

function payload(over: Partial<PerfAlertPayload> = {}): PerfAlertPayload {
  return {
    status: "firing",
    alert: {
      alertname: "KannaMemoryPressure",
      service_version: "1.38.0",
      summary: "Kanna RSS is close to the pm2 restart ceiling",
      description: "Resident memory averaged over 1.8 GiB for 25 minutes.",
      runbook: "Send SIGUSR2 to write a heap snapshot.",
      code_hints: "src/server/event-store-messages.adapter.ts — TranscriptCache: one oversized transcript is never evicted",
      promql: "avg_over_time(kanna_process_rss_bytes[15m])",
      threshold: "1887436800",
    },
    instances: [
      { host: "cuong's MacBook Air", service: "kanna-cuongs-macbook-air", version: "1.38.0", value: "2286000000", status: "firing" },
      { host: "Hip's Mac mini", service: "kanna-hips-mac-mini", version: "1.38.0", value: "1964000000", status: "firing" },
    ],
    grafana_url: "https://kanna-grafana.lowbit.link",
    ...over,
  }
}

function openIssue(over: Partial<OpenIssue> = {}): OpenIssue {
  return { number: 1, body: `x ${alertMarker(payload())} y`, updatedAt: 0, ...over }
}

describe("renderIssue", () => {
  test("body carries every affected host so one ticket covers the fleet", () => {
    const { body } = renderIssue(payload())
    expect(body).toContain("kanna-cuongs-macbook-air")
    expect(body).toContain("kanna-hips-mac-mini")
  })

  test("body carries what an agent needs to start fixing", () => {
    const { body } = renderIssue(payload())
    expect(body).toContain("avg_over_time(kanna_process_rss_bytes[15m])")
    expect(body).toContain("src/server/event-store-messages.adapter.ts")
    expect(body).toContain("Send SIGUSR2")
    expect(body).toContain("https://kanna-grafana.lowbit.link")
  })

  test("labels route the ticket to an agent", () => {
    expect(renderIssue(payload()).labels).toEqual(["performance", "agent-fix"])
  })

  // The marker is the dedup key AND readable by a human scanning the issue —
  // an opaque hash would make a mis-grouped ticket impossible to diagnose.
  test("marker identifies the rule and the release", () => {
    expect(alertMarker(payload())).toBe("<!-- kanna-alert:KannaMemoryPressure@1.38.0 -->")
    expect(renderIssue(payload()).body).toContain(alertMarker(payload()))
  })

  test("an install too old to report a version still groups deterministically", () => {
    const old = payload({ alert: { ...payload().alert, service_version: "" } })
    expect(alertMarker(old)).toBe("<!-- kanna-alert:KannaMemoryPressure@unversioned -->")
  })
})

describe("decideAction", () => {
  const now = 10 * QUIET_PERIOD_MS

  test("opens a ticket when the rule fires and none is tracking it", () => {
    expect(decideAction(payload(), [], now).kind).toBe("create")
  })

  test("comments instead of opening a second ticket for the same rule", () => {
    const action = decideAction(payload(), [openIssue({ number: 7 })], now)
    expect(action).toMatchObject({ kind: "comment", number: 7 })
  })

  // A rule re-notifies on Grafana's repeat interval. Commenting every time
  // turns one regression into an unreadable thread.
  test("stays quiet when the ticket was just updated", () => {
    const action = decideAction(payload(), [openIssue({ updatedAt: now - 1000 })], now)
    expect(action).toMatchObject({ kind: "skip", reason: "recently_updated" })
  })

  test("closes the ticket when the alert resolves", () => {
    const action = decideAction(payload({ status: "resolved" }), [openIssue({ number: 7 })], now)
    expect(action).toMatchObject({ kind: "close", number: 7 })
  })

  test("a resolve with nothing open is not an error", () => {
    expect(decideAction(payload({ status: "resolved" }), [], now).kind).toBe("skip")
  })

  // The ingest endpoint is unauthenticated, so forged metrics can drive this
  // path. The cap is what stops that from becoming unbounded issue creation.
  test("refuses to open more than the cap allows", () => {
    const unrelated = Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
      openIssue({ number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` }))
    const action = decideAction(payload(), unrelated, now)
    expect(action).toMatchObject({ kind: "skip", reason: "open_issue_cap" })
  })

  // The cap must never block the resolve path, or a storm would leave every
  // ticket it opened stuck open forever.
  test("the cap does not block closing an existing ticket", () => {
    const issues = [
      openIssue({ number: 7 }),
      ...Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
        openIssue({ number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` })),
    ]
    expect(decideAction(payload({ status: "resolved" }), issues, now).kind).toBe("close")
  })
})
