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
      ticket_scope: "condition",
    },
    instances: [
      { host: "cuong's MacBook Air", service: "kanna-cuongs-macbook-air", version: "1.38.0", value: "2286000000", status: "firing" },
      { host: "Hip's Mac mini", service: "kanna-hips-mac-mini", version: "1.38.0", value: "1964000000", status: "firing" },
    ],
    grafana_url: "https://kanna-grafana.lowbit.link",
    ...over,
  }
}

function releasePayload(over: Partial<PerfAlertPayload> = {}): PerfAlertPayload {
  const base = payload()
  return {
    ...base,
    alert: {
      ...base.alert,
      alertname: "KannaMemoryReleaseRegression",
      summary: "One release uses materially more memory than the best release",
      ticket_scope: "release",
    },
    ...over,
  }
}

function trackedIssue(
  tracks: PerfAlertPayload,
  over: Partial<KnownIssue> = {},
): KnownIssue {
  return { number: 1, body: `x ${alertMarker(tracks)} y`, updatedAt: 0, closed: null, ...over }
}

const openIssue = (over: Partial<KnownIssue> = {}) => trackedIssue(payload(), over)
const closedIssue = (at: number, over: Partial<KnownIssue> = {}) =>
  trackedIssue(payload(), { closed: { at, reason: "completed" }, updatedAt: at, ...over })

const openRelease = (over: Partial<KnownIssue> = {}) => trackedIssue(releasePayload(), over)
const closedRelease = (at: number, over: Partial<KnownIssue> = {}) =>
  trackedIssue(releasePayload(), { closed: { at, reason: "completed" }, updatedAt: at, ...over })

const muted = (issue: KnownIssue, at: number): KnownIssue =>
  ({ ...issue, closed: { at, reason: "not_planned" }, updatedAt: at })

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

  test("both scopes tell the reader how to mute the rule", () => {
    expect(renderIssue(payload()).body).toContain("Close as not planned")
    expect(renderIssue(releasePayload()).body).toContain("Close as not planned")
  })

  test("a condition title names the condition, not the release", () => {
    expect(renderIssue(payload()).title)
      .toBe("perf: Kanna RSS is close to the pm2 restart ceiling")
  })

  test("a release title names the release it is about", () => {
    expect(renderIssue(releasePayload()).title)
      .toBe("perf: One release uses materially more memory than the best release (1.38.0)")
  })

  test("a condition ticket says it stays open", () => {
    expect(renderIssue(payload()).body).toContain("stays open")
  })
})

describe("alertMarker", () => {
  test("a condition marker is keyed on the rule alone", () => {
    expect(alertMarker(payload())).toBe("<!-- kanna-alert:KannaMemoryPressure -->")
    expect(renderIssue(payload()).body).toContain(alertMarker(payload()))
  })

  test("a release marker is keyed on the rule and the release", () => {
    expect(alertMarker(releasePayload()))
      .toBe("<!-- kanna-alert:KannaMemoryReleaseRegression@1.38.0 -->")
  })

  test("an install too old to report a version still groups deterministically", () => {
    const old = releasePayload({ alert: { ...releasePayload().alert, service_version: "" } })
    expect(alertMarker(old)).toBe("<!-- kanna-alert:KannaMemoryReleaseRegression@unversioned -->")
  })

  test("the two marker shapes cannot match each other", () => {
    const versionScoped = "<!-- kanna-alert:KannaMemoryPressure@1.41.3 -->"
    expect(versionScoped.includes(alertMarker(payload()))).toBe(false)
    expect(renderIssue(payload()).body.includes(versionScoped)).toBe(false)
  })

  test("a notification carrying no scope keeps the conservative version scope", () => {
    const { ticket_scope: _dropped, ...alert } = payload().alert
    expect(alertMarker(payload({ alert }))).toBe("<!-- kanna-alert:KannaMemoryPressure@1.38.0 -->")
  })

  test("a garbled scope is not treated as a condition", () => {
    const odd = payload({ alert: { ...payload().alert, ticket_scope: "Condition" } })
    expect(alertMarker(odd)).toBe("<!-- kanna-alert:KannaMemoryPressure@1.38.0 -->")
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

  test("stays quiet when the ticket was just updated", () => {
    const action = decideAction(payload(), [openIssue({ updatedAt: now - 1000 })], now)
    expect(action).toMatchObject({ kind: "skip", reason: "recently_updated" })
  })

  test("refuses to open more than the cap allows", () => {
    const unrelated = Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
      openIssue({ number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` }))
    const action = decideAction(payload(), unrelated, now)
    expect(action).toMatchObject({ kind: "skip", reason: "open_issue_cap" })
  })

  test("closed tickets do not count against the cap", () => {
    const settled = Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
      closedIssue(now - 1000, { number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` }))
    expect(decideAction(payload(), settled, now).kind).toBe("create")
  })
})

describe("decideAction on a release rule", () => {
  const now = 10 * QUIET_PERIOD_MS

  test("closes the ticket when the alert resolves", () => {
    const action = decideAction(
      releasePayload({ status: "resolved" }),
      [openRelease({ number: 7 })],
      now,
    )
    expect(action).toMatchObject({ kind: "close", number: 7 })
  })

  test("a resolve with nothing open is not an error", () => {
    expect(decideAction(releasePayload({ status: "resolved" }), [], now).kind).toBe("skip")
  })

  test("the cap does not block closing an existing ticket", () => {
    const issues = [
      openRelease({ number: 7 }),
      ...Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
        openIssue({ number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` })),
    ]
    expect(decideAction(releasePayload({ status: "resolved" }), issues, now).kind).toBe("close")
  })

  test("a resolve ignores an already-closed ticket", () => {
    const action = decideAction(
      releasePayload({ status: "resolved" }),
      [closedRelease(now - 60_000, { number: 843 })],
      now,
    )
    expect(action).toMatchObject({ kind: "skip", reason: "nothing_to_close" })
  })

  test("a mute on one release does not silence the next", () => {
    const stale = muted(closedRelease(now - 60_000, { number: 843 }), now - 60_000)
    const next = releasePayload({
      alert: { ...releasePayload().alert, service_version: "1.40.5" },
    })
    expect(decideAction(next, [stale], now).kind).toBe("create")
  })
})

describe("decideAction on a condition rule", () => {
  const now = 10 * QUIET_PERIOD_MS

  test("a release bump comments on the one ticket instead of filing another", () => {
    const upgraded = payload({ alert: { ...payload().alert, service_version: "1.41.3" } })
    expect(decideAction(upgraded, [openIssue({ number: 863 })], now))
      .toMatchObject({ kind: "comment", number: 863 })
  })

  test("a resolve leaves the ticket open", () => {
    const action = decideAction(payload({ status: "resolved" }), [openIssue({ number: 7 })], now)
    expect(action).toMatchObject({ kind: "skip", reason: "condition_stays_open" })
  })

  test("a resolve with no ticket open is still a no-op", () => {
    expect(decideAction(payload({ status: "resolved" }), [], now).kind).toBe("skip")
  })

  test("a mute survives a release bump", () => {
    const stale = muted(closedIssue(now - 60_000, { number: 863 }), now - 60_000)
    const upgraded = payload({ alert: { ...payload().alert, service_version: "1.42.0" } })
    expect(decideAction(upgraded, [stale], now)).toMatchObject({ kind: "skip", reason: "muted" })
  })
})

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

  test("respects a not-planned close as a mute", () => {
    const stale = muted(closedIssue(now - 60_000, { number: 843 }), now - 60_000)
    expect(decideAction(payload(), [stale], now)).toMatchObject({ kind: "skip", reason: "muted" })
  })

  test("a mute is not bounded by the reopen window", () => {
    const ancient = muted(
      closedIssue(now - REOPEN_WINDOW_MS - 1, { number: 843 }),
      now - REOPEN_WINDOW_MS - 1,
    )
    expect(decideAction(payload(), [ancient], now)).toMatchObject({ kind: "skip", reason: "muted" })
  })

  test("a mute wins over a more recent auto-close", () => {
    const issues = [
      muted(closedIssue(now - 2 * 60 * 60 * 1000, { number: 827 }), now - 2 * 60 * 60 * 1000),
      closedIssue(now - 60_000, { number: 840 }),
    ]
    expect(decideAction(payload(), issues, now)).toMatchObject({ kind: "skip", reason: "muted" })
  })

  test("an open ticket still wins over a closed one", () => {
    const issues = [closedIssue(now - 60_000, { number: 840 }), openIssue({ number: 843 })]
    expect(decideAction(payload(), issues, now)).toMatchObject({ kind: "comment", number: 843 })
  })

  test("the cap does not block a reopen", () => {
    const issues = [
      closedIssue(now - 60_000, { number: 843 }),
      ...Array.from({ length: MAX_OPEN_PERF_ISSUES }, (_, i) =>
        openIssue({ number: 100 + i, body: `<!-- kanna-alert:Other${i}@1.0.0 -->` })),
    ]
    expect(decideAction(payload(), issues, now).kind).toBe("reopen")
  })
})
