/**
 * CronJobsPage — the page owns its scroll container.
 *
 * The shell pins `html`/`body`/`#root` to `h-[100dvh] overflow-hidden` and
 * wraps the `Outlet` in `flex flex-1 flex-col overflow-hidden` (App.tsx), so a
 * route page that does not scroll ITSELF is clipped at the viewport edge with
 * no scrollbar and no touch scroll. Issue #772 is exactly that: six armed cron
 * jobs on a phone, and the rows below the fold were unreachable.
 *
 * Mounted through `renderClientMarkup` rather than `renderToStaticMarkup`
 * because the page reads `useCronJobsStore`, and zustand v5 serves
 * `getInitialState()` as the server snapshot — a `setState` here would be
 * invisible to a server render.
 */

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

/**
 * `KannaSocket` is a class with private fields, so a structural literal needs a
 * cast — the precedent set by `KannaSocketProvider.test.tsx`. The page only
 * ever calls `command`, and only from a click handler.
 */
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
      // Height participation AND scrolling: without `min-h-0` a flex child
      // refuses to shrink below its content, so `overflow-y-auto` never
      // engages and the content is clipped instead of scrolled.
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
      // A scrollbar inside the centred column would sit mid-page rather than at
      // the viewport edge, so the max-width block must NOT be the scroller.
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
      // Nothing truncates the list; the defect was purely that the overflow
      // could not be reached, so the guarantee is "rendered AND scrollable".
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

/**
 * The controls address the ARMING chat, not the page. A row on the global page
 * belongs to a different chat than the one next to it, so a command that lost
 * its `chatId` would silently act on nothing (or on the wrong job).
 */
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
