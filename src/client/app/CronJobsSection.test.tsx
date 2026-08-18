import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { CronJobSnapshot } from "../../shared/cron/types"
import { CronJobsSection } from "./CronJobsSection"

function job(overrides: Partial<CronJobSnapshot> = {}): CronJobSnapshot {
  return {
    jobId: "cron-abc",
    instruction: "check ci",
    mode: "inline",
    scheduleText: "every 5m",
    schedule: { type: "interval", ms: 300_000 },
    paused: false,
    armedAt: 1_000,
    nextFireAt: 301_000,
    lastRun: null,
    recentRuns: [],
    ...overrides,
  }
}

const noop = () => {}

describe("CronJobsSection — schedule vs. run status display model", () => {
  test("active job with lastRun running shows Running badge", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[job({ lastRun: { runId: "r1", firedAt: 2_000, status: "running" } })]}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain("Running")
    expect(html).not.toContain("Paused")
  })

  test("paused job shows Paused as primary indicator before any run status", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[job({ paused: true, lastRun: { runId: "r1", firedAt: 2_000, status: "running" } })]}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain("Paused")
    const pausedIdx = html.indexOf("Paused")
    const runningIdx = html.indexOf("Running")
    expect(pausedIdx).toBeGreaterThanOrEqual(0)
    expect(runningIdx).toBeGreaterThan(pausedIdx)
  })

  test("paused job does not say 'running for'", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[job({ paused: true })]}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    )
    expect(html).not.toContain("running for")
  })

  test("active job shows 'running for' elapsed time", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[job({ paused: false })]}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain("running for")
  })

  test("paused job with running lastRun labels the run status separately", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[job({ paused: true, lastRun: { runId: "r1", firedAt: 2_000, status: "running" } })]}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain("Last run:")
    expect(html).toContain("Running")
  })

  test("resumed (active) job with completed lastRun shows Completed badge, no Paused", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[job({ paused: false, lastRun: { runId: "r1", firedAt: 2_000, status: "completed" } })]}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain("Completed")
    expect(html).not.toContain("Paused")
  })
})
