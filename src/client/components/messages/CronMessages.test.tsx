import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import type { CronJobSnapshot } from "../../../shared/cron/types"
import { CronArmedMessage } from "./CronArmedMessage"
import { CronCommandErrorMessage } from "./CronCommandErrorMessage"
import { CronJobChangeMessage } from "./CronJobChangeMessage"
import { CronListMessage } from "./CronListMessage"
import { CronRunMessage } from "./CronRunMessage"
import { CronRunSkippedMessage } from "./CronRunSkippedMessage"

const base = { id: "m-1", timestamp: "2026-08-16T00:00:00Z" }

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

describe("CronArmedMessage", () => {
  test("shows instruction, id, humanized schedule, and the inline monitoring note", () => {
    const html = renderToStaticMarkup(
      <CronArmedMessage
        message={{
          ...base,
          kind: "cron_armed",
          jobId: "cron-abc",
          instruction: "check ci",
          mode: "inline",
          scheduleText: "every 5m",
          scheduleHuman: "every 5 minutes",
          nextFireAt: Date.now() + 300_000,
        }}
      />,
    )
    expect(html).toContain("Cron job armed")
    expect(html).toContain("cron-abc")
    expect(html).toContain("check ci")
    expect(html).toContain("every 5 minutes")
    expect(html).toContain("monitoring view")
  })
})

describe("CronCommandErrorMessage", () => {
  test("shows the error and the ready-to-send suggestion", () => {
    const html = renderToStaticMarkup(
      <CronCommandErrorMessage
        message={{
          ...base,
          kind: "cron_command_error",
          message: 'unknown mode "spwan"',
          suggestion: "/cron check ci spawn @daily",
        }}
      />,
    )
    expect(html).toContain("Invalid /cron command")
    expect(html).toContain("spwan")
    expect(html).toContain("/cron check ci spawn @daily")
    expect(html).toContain("Copy fix")
  })

  test("no suggestion renders no copy affordance", () => {
    const html = renderToStaticMarkup(
      <CronCommandErrorMessage
        message={{ ...base, kind: "cron_command_error", message: "missing instruction" }}
      />,
    )
    expect(html).not.toContain("Copy fix")
  })

  // `/cron` starts no turn, so this card is the only place the typed line can
  // appear — without it the reader is told a line is wrong but not which one.
  test("shows the line that failed", () => {
    const html = renderToStaticMarkup(
      <CronCommandErrorMessage
        message={{
          ...base,
          kind: "cron_command_error",
          message: "cron schedule has 3 fields, expected 5",
          input: "/cron check CI inline 9am every day",
        }}
      />,
    )
    expect(html).toContain("/cron check CI inline 9am every day")
  })

  test("renders without an input, for errors with no single offending line", () => {
    const html = renderToStaticMarkup(
      <CronCommandErrorMessage
        message={{ ...base, kind: "cron_command_error", message: "missing instruction" }}
      />,
    )
    expect(html).toContain("missing instruction")
  })
})

describe("CronRunMessage", () => {
  test("joins live status by runId and links the spawned chat", () => {
    const jobs = [
      job({
        mode: "spawn",
        recentRuns: [{ runId: "run-1", firedAt: 2_000, status: "completed", spawnedChatId: "chat-9" }],
        lastRun: { runId: "run-1", firedAt: 2_000, status: "completed", spawnedChatId: "chat-9" },
      }),
    ]
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CronRunMessage
          message={{
            ...base,
            kind: "cron_run",
            jobId: "cron-abc",
            runId: "run-1",
            instruction: "nightly report",
            spawnedChatId: "chat-9",
            firedAt: 2_000,
          }}
          cronJobs={jobs}
        />
      </MemoryRouter>,
    )
    expect(html).toContain("Completed")
    expect(html).toContain("/chat/chat-9")
    expect(html).toContain("nightly report")
  })
})

describe("CronRunSkippedMessage", () => {
  test("describes each skip reason", () => {
    const busy = renderToStaticMarkup(
      <CronRunSkippedMessage message={{ ...base, kind: "cron_run_skipped", jobId: "cron-abc", reason: "chat_busy" }} />,
    )
    expect(busy).toContain("chat was busy")

    const offline = renderToStaticMarkup(
      <CronRunSkippedMessage
        message={{ ...base, kind: "cron_run_skipped", jobId: "cron-abc", reason: "server_offline", missedCount: 4 }}
      />,
    )
    expect(offline).toContain("4 fires missed")
  })
})

describe("CronListMessage", () => {
  test("renders the live job list and the help block when asked", () => {
    const html = renderToStaticMarkup(
      <CronListMessage message={{ ...base, kind: "cron_list", help: true }} cronJobs={[job()]} />,
    )
    expect(html).toContain("cron-abc")
    expect(html).toContain("every 5 minutes")
    expect(html).toContain("/cron list")
  })

  test("empty list says so", () => {
    const html = renderToStaticMarkup(<CronListMessage message={{ ...base, kind: "cron_list" }} cronJobs={[]} />)
    expect(html).toContain("No cron jobs armed")
  })
})

describe("CronJobChangeMessage", () => {
  test("renders the change verb", () => {
    const html = renderToStaticMarkup(
      <CronJobChangeMessage message={{ ...base, kind: "cron_job_change", jobId: "cron-abc", change: "paused" }} />,
    )
    expect(html).toContain("cron-abc")
    expect(html).toContain("paused")
  })
})
