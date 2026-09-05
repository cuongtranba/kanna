import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { CronJobSnapshot, CronRunSnapshot } from "../../shared/cron/types"
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

function withRun(run: CronRunSnapshot, overrides: Partial<CronJobSnapshot> = {}): CronJobSnapshot {
  return job({ lastRun: run, recentRuns: [run], ...overrides })
}

function render(jobs: readonly CronJobSnapshot[]): string {
  return renderToStaticMarkup(<CronJobsSection jobs={jobs} chatId="chat-1" />)
}

describe("CronJobsSection — schedule vs. run status display model", () => {
  test("active job with lastRun running shows Running badge", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "running" })])
    expect(html).toContain("Running")
    expect(html).not.toContain("Paused")
  })

  test("paused job shows Paused as primary indicator before any run status", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "running" }, { paused: true })])
    expect(html).toContain("Paused")
    const pausedIdx = html.indexOf("Paused")
    const runningIdx = html.indexOf("Running")
    expect(pausedIdx).toBeGreaterThanOrEqual(0)
    expect(runningIdx).toBeGreaterThan(pausedIdx)
  })

  test("paused job does not say 'running for'", () => {
    expect(render([job({ paused: true })])).not.toContain("running for")
  })

  test("active job with no lastRun does not say 'running for'", () => {
    expect(render([job({ paused: false, lastRun: null })])).not.toContain("running for")
  })

  test("active job with lastRun skipped does not say 'running for'", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "skipped" })])
    expect(html).not.toContain("running for")
  })

  test("active job with lastRun completed does not say 'running for'", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "completed" })])
    expect(html).not.toContain("running for")
  })

  test("active job with lastRun failed does not say 'running for'", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "failed" })])
    expect(html).not.toContain("running for")
  })

  test("active job with lastRun running shows 'running for' derived from firedAt not armedAt", () => {
    const html = render([
      withRun({ runId: "r1", firedAt: 5_000, status: "running" }, { paused: false, armedAt: 1_000 }),
    ])
    expect(html).toContain("running for")
  })

  test("paused job with running lastRun labels the run status separately", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "running" }, { paused: true })])
    expect(html).toContain("Last run:")
    expect(html).toContain("Running")
  })

  test("resumed (active) job with completed lastRun shows Completed badge, no Paused", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "completed" })])
    expect(html).toContain("Completed")
    expect(html).not.toContain("Paused")
  })
})

describe("CronJobsSection — edit affordance", () => {
  test("every row offers an edit control", () => {
    expect(render([job()])).toContain('aria-label="Edit cron job cron-abc"')
  })

  test("edit is marked unavailable while a run is in flight, and says why", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "running" })])
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain("cannot edit while a run is in flight")
  })

  test("a settled run leaves edit available", () => {
    const html = render([withRun({ runId: "r1", firedAt: 2_000, status: "completed" })])
    expect(html).toContain('aria-disabled="false"')
    expect(html).not.toContain("cannot edit while a run is in flight")
  })

  test("a skipped run is looked past — the job is not actually running", () => {
    const html = renderToStaticMarkup(
      <CronJobsSection
        jobs={[
          job({
            lastRun: { runId: "r2", firedAt: 3_000, status: "skipped" },
            recentRuns: [
              { runId: "r2", firedAt: 3_000, status: "skipped" },
              { runId: "r1", firedAt: 2_000, status: "completed" },
            ],
          }),
        ]}
        chatId="chat-1"
      />,
    )
    expect(html).toContain('aria-disabled="false"')
  })
})
