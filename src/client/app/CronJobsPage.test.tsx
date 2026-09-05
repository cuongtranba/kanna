
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import type { CronJobsGlobalRow } from "../../shared/cron/types"
import { SHELL_PAGE_SCROLL_CLASS } from "../lib/shellChrome"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { useCronJobsStore } from "../stores/cronJobsStore"
import { CronJobsPage } from "./CronJobsPage"
import { KannaSocketProvider } from "./KannaSocketProvider"
import type { KannaSocket } from "./socket"

const sentCommands: unknown[] = []

const FAKE_SOCKET = {
  start(): void {},
  dispose(): void {},
  command(command: unknown): Promise<unknown> {
    sentCommands.push(command)
    return Promise.resolve({})
  },
} as unknown as KannaSocket

function row(index: number): CronJobsGlobalRow {
  return {
    projectId: `project-${String(index)}`,
    projectPath: `/repo/project-${String(index)}`,
    chatId: `chat-${String(index)}`,
    chatTitle: `chat ${String(index)}`,
    job: {
      jobId: `cron-${String(index)}`,
      instruction: `check ci ${String(index)}`,
      mode: "inline",
      scheduleText: "every 5m",
      schedule: { type: "interval", ms: 300_000 },
      paused: false,
      armedAt: 1_000,
      nextFireAt: 301_000,
      lastRun: null,
      recentRuns: [],
    },
  }
}

async function mountPage(rows: readonly CronJobsGlobalRow[]) {
  useCronJobsStore.setState({ rows })
  return renderClientMarkup(
    <MemoryRouter>
      <KannaSocketProvider socket={FAKE_SOCKET}>
        <CronJobsPage />
      </KannaSocketProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  useCronJobsStore.setState({ rows: [] })
  sentCommands.length = 0
})

describe("CronJobsPage scroll container (#772)", () => {
  test("root is its own scroll container — the shell outlet is overflow-hidden", async () => {
    const { container, cleanup } = await mountPage([row(1)])
    try {
      const root = container.firstElementChild
      expect(root).not.toBeNull()
      const cls = root?.className ?? ""
      expect(cls).toContain("overflow-y-auto")
      expect(cls).toContain("min-h-0")
      expect(cls).toContain("flex-1")
    } finally {
      await cleanup()
    }
  })

  test("the scroll container is the root, not the 900px reading column", async () => {
    const { container, cleanup } = await mountPage([row(1)])
    try {
      const column = container.querySelector(".max-w-\\[900px\\]")
      expect(column).not.toBeNull()
      expect(column?.className ?? "").not.toContain("overflow-y-auto")
    } finally {
      await cleanup()
    }
  })

  test("every armed job is rendered — a job below the fold is reachable", async () => {
    const rows = [row(1), row(2), row(3), row(4), row(5), row(6)]
    const { container, cleanup } = await mountPage(rows)
    try {
      for (const entry of rows) {
        expect(container.textContent ?? "").toContain(entry.job.instruction)
      }
      expect(container.firstElementChild?.className ?? "").toContain("overflow-y-auto")
    } finally {
      await cleanup()
    }
  })

  test("uses the shared shell page-scroll class rather than a re-typed literal", async () => {
    const { container, cleanup } = await mountPage([row(1)])
    try {
      const cls = container.firstElementChild?.className ?? ""
      for (const token of SHELL_PAGE_SCROLL_CLASS.split(" ")) {
        expect(cls).toContain(token)
      }
    } finally {
      await cleanup()
    }
  })
})

describe("CronJobsPage row controls", () => {
  async function clickLabelled(container: HTMLElement, label: string): Promise<void> {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!button) throw new Error(`no button labelled "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  test("pause targets the job's own chat", async () => {
    const { container, cleanup } = await mountPage([row(1), row(2)])
    try {
      await clickLabelled(container, "Pause cron job cron-2")
      expect(sentCommands).toEqual([{ type: "cron.pause", chatId: "chat-2", jobId: "cron-2" }])
    } finally {
      await cleanup()
    }
  })

  test("editing a job sends one cron.update carrying only what changed", async () => {
    const { container, cleanup } = await mountPage([row(1)])
    try {
      await clickLabelled(container, "Edit cron job cron-1")
      const schedule = document.querySelector<HTMLInputElement>("#cron-edit-schedule")
      if (!schedule) throw new Error("dialog did not open")
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(schedule, "@daily")
        schedule.dispatchEvent(new Event("input", { bubbles: true }))
      })
      const save = [...document.querySelectorAll("button")].find((node) => node.textContent === "Save")
      if (!save) throw new Error("no Save button")
      await act(async () => {
        save.click()
      })
      expect(sentCommands).toHaveLength(1)
      expect(sentCommands[0]).toMatchObject({
        type: "cron.update",
        chatId: "chat-1",
        jobId: "cron-1",
        patch: { scheduleText: "@daily" },
      })
    } finally {
      await cleanup()
    }
  })
})
