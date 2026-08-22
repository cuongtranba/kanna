import { describe, expect, test } from "bun:test"
import {
  MAX_OPEN_PERF_ISSUES,
  QUIET_PERIOD_MS,
  REOPEN_WINDOW_MS,
  alertMarker,
  decideAction,
  renderIssue,
  type KnownIssue,
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

function openIssue(over: Partial<KnownIssue> = {}): KnownIssue {
  return { number: 1, body: `x ${alertMarker(payload())} y`, updatedAt: 0, closed: null, ...over }
}

function closedIssue(at: number, over: Partial<KnownIssue> = {}): KnownIssue {
  return openIssue({ closed: { at, reason: "completed" }, updatedAt: at, ...over })
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

  // The mute is a plain GitHub gesture with nothing in the UI to hint at it, so
  // the ticket that offers it is the only place it can be discovered.
  test("body tells the reader how to mute a rule for a release", () => {
    expect(renderIssue(payload()).body).toContain("Close as not planned")
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

  // The cap bounds how many tickets are OPEN. Counting settled ones would let a
  // few months of resolved history wedge the pipeline shut.
  test("closed tickets do not count against the cap", () => {
    const settled = Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
      closedIssue(now - 1000, { number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` }))
    expect(decideAction(payload(), settled, now).kind).toBe("create")
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

// A rule that dips under its threshold closes its ticket, and the next breach
// used to match nothing and file a fresh one — five identical
// KannaMemoryPressure tickets in five hours (#827, #833, #836, #840, #843).
// A flap is one episode, so it gets one ticket.
describe("decideAction over a flapping alert", () => {
  const now = 10 * QUIET_PERIOD_MS

  test("reopens the ticket it just closed instead of filing another", () => {
    const action = decideAction(payload(), [closedIssue(now - 60_000, { number: 843 })], now)
    expect(action).toMatchObject({ kind: "reopen", number: 843 })
  })

  test("the quiet period never suppresses a reopen", () => {
    const justClosed = closedIssue(now - 1000, { number: 843, updatedAt: now - 1000 })
    expect(decideAction(payload(), [justClosed], now).kind).toBe("reopen")
  })

  // Past the window the cause is a new episode, not the same one still flapping,
  // and resurrecting a months-old thread reads as noise rather than history.
  test("files fresh once the old ticket is older than the reopen window", () => {
    const stale = closedIssue(now - REOPEN_WINDOW_MS - 1, { number: 843 })
    expect(decideAction(payload(), [stale], now).kind).toBe("create")
  })

  test("reopens the most recently closed ticket when several match", () => {
    const issues = [
      closedIssue(now - 5 * 60 * 60 * 1000, { number: 827 }),
      closedIssue(now - 60_000, { number: 840 }),
      closedIssue(now - 2 * 60 * 60 * 1000, { number: 836 }),
    ]
    expect(decideAction(payload(), issues, now)).toMatchObject({ kind: "reopen", number: 840 })
  })

  // Closing as "not planned" is the operator saying stop telling me about this
  // release — the mute for a stale install whose fix already shipped.
  test("respects a not-planned close as a mute for that release", () => {
    const muted = closedIssue(now - 60_000, { number: 843 })
    muted.closed = { at: now - 60_000, reason: "not_planned" }
    expect(decideAction(payload(), [muted], now)).toMatchObject({ kind: "skip", reason: "muted" })
  })

  // The marker carries the version, so shipping a fix gets a new group and the
  // mute on the old release cannot swallow a regression in the new one.
  test("a mute on one release does not silence the next", () => {
    const muted = closedIssue(now - 60_000, { number: 843 })
    muted.closed = { at: now - 60_000, reason: "not_planned" }
    const next = payload({ alert: { ...payload().alert, service_version: "1.40.5" } })
    expect(decideAction(next, [muted], now).kind).toBe("create")
  })

  test("an open ticket still wins over a closed one", () => {
    const issues = [closedIssue(now - 60_000, { number: 840 }), openIssue({ number: 843 })]
    expect(decideAction(payload(), issues, now)).toMatchObject({ kind: "comment", number: 843 })
  })

  // Reopening is bounded by the markers already ticketed, so it cannot be the
  // unbounded-creation path the cap exists to stop.
  test("the cap does not block a reopen", () => {
    const issues = [
      closedIssue(now - 60_000, { number: 843 }),
      ...Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
        openIssue({ number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` })),
    ]
    expect(decideAction(payload(), issues, now).kind).toBe("reopen")
  })

  test("a resolve ignores an already-closed ticket", () => {
    const action = decideAction(
      payload({ status: "resolved" }),
      [closedIssue(now - 60_000, { number: 843 })],
      now,
    )
    expect(action).toMatchObject({ kind: "skip", reason: "nothing_to_close" })
  })
})
