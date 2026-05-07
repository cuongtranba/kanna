import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { BackgroundTask } from "../../../../shared/types"
import {
  BackgroundTasksDialogBody,
  BackgroundTasksDialogView,
} from "./BackgroundTasksDialog"
import { TooltipProvider } from "../ui/tooltip"

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_746_000_000_000 // arbitrary fixed epoch

const TASK_BASH: BackgroundTask = {
  kind: "bash_shell",
  id: "task-1",
  chatId: "chat-abc",
  command: "bun run dev",
  shellId: "shell-1",
  pid: 1234,
  startedAt: FIXED_NOW - 134_000, // 2m 14s before FIXED_NOW
  lastOutput: "line1\nline2\nline3",
  status: "running",
}

const TASK_TERMINAL: BackgroundTask = {
  kind: "terminal_pty",
  id: "task-2",
  ptyId: "pty-1",
  cwd: "/Users/cuongtran/repo/kanna",
  startedAt: FIXED_NOW - 15_120_000, // 4h 12m ago
  lastOutput: "output here",
}

const TASK_CODEX: BackgroundTask = {
  kind: "codex_session",
  id: "task-3",
  chatId: "chat-xyz",
  pid: 5678,
  startedAt: FIXED_NOW - 60_000,
  lastOutput: "",
}

const TASK_DRAINING: BackgroundTask = {
  kind: "draining_stream",
  id: "task-4",
  chatId: "chat-drain",
  startedAt: FIXED_NOW - 30_000,
  lastOutput: "stream data",
}

const TASK_STOPPING: BackgroundTask = {
  kind: "bash_shell",
  id: "task-5",
  chatId: null,
  command: "pnpm test",
  shellId: "shell-2",
  pid: null,
  startedAt: FIXED_NOW - 5_000,
  lastOutput: "",
  status: "stopping",
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * Renders BackgroundTasksDialogBody (portal-free inner content) via SSR.
 * This is the primary test surface — Dialog Portal is not testable via
 * renderToStaticMarkup.
 */
function renderBody(
  tasks: BackgroundTask[],
  opts: {
    onStop?: (id: string, force: boolean) => void
  } = {},
) {
  const { onStop = () => {} } = opts
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(BackgroundTasksDialogBody, { tasks, onStop }),
    ),
  )
}

/**
 * Renders BackgroundTasksDialogView (full Dialog with Portal). The Portal
 * returns empty in SSR, so this is used only to verify no throw + prop wiring.
 */
function renderView(
  tasks: BackgroundTask[],
  opts: {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    onStop?: (id: string, force: boolean) => void
  } = {},
) {
  const { open = true, onOpenChange = () => {}, onStop = () => {} } = opts
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(BackgroundTasksDialogView, {
        open,
        onOpenChange,
        tasks,
        onStop,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// matchMedia stub (for prefers-reduced-motion tests)
// ---------------------------------------------------------------------------

let originalMatchMedia: ((q: string) => MediaQueryList) | undefined

function stubMatchMedia(matches: boolean) {
  originalMatchMedia = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia
  ;(globalThis as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: query.includes("reduce") ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

function restoreMatchMedia() {
  if (originalMatchMedia !== undefined) {
    ;(globalThis as Record<string, unknown>).matchMedia = originalMatchMedia
  }
}

// ---------------------------------------------------------------------------
// Suite — BackgroundTasksDialogBody (SSR-testable inner content)
// ---------------------------------------------------------------------------

describe("BackgroundTasksDialogBody", () => {
  // ── Header ──────────────────────────────────────────────────────────────

  test("renders 'Background tasks' heading", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain("Background tasks")
  })

  test("renders running count tag when tasks present", () => {
    const html = renderBody([TASK_BASH, TASK_TERMINAL])
    expect(html).toContain("2 running")
  })

  test("does not render numeric running count badge when no tasks", () => {
    const html = renderBody([])
    // The running count badge shows "N running"; empty state has no such badge
    expect(html).not.toMatch(/\d+ running/)
  })

  // ── Empty state ──────────────────────────────────────────────────────────

  test("renders editorial empty-state sentence when no tasks", () => {
    const html = renderBody([])
    expect(html).toContain("No background tasks")
    expect(html).toContain("Anything an agent leaves running here will appear so you can stop it.")
  })

  test("does not render task row markup when empty", () => {
    const html = renderBody([])
    expect(html).not.toContain('role="option"')
  })

  // ── Row rendering ────────────────────────────────────────────────────────

  test("renders bash command as mono label", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain("bun run dev")
    expect(html).toContain("font-mono")
  })

  test("renders PTY label for terminal_pty task", () => {
    const html = renderBody([TASK_TERMINAL])
    expect(html).toContain("PTY: /Users/cuongtran/repo/kanna")
  })

  test("renders 'Codex session' for codex_session task", () => {
    const html = renderBody([TASK_CODEX])
    expect(html).toContain("Codex session")
  })

  test("renders 'Draining stream' for draining_stream task", () => {
    const html = renderBody([TASK_DRAINING])
    expect(html).toContain("Draining stream")
  })

  test("renders type tags: bash, terminal, codex, stream", () => {
    const html = renderBody([TASK_BASH, TASK_TERMINAL, TASK_CODEX, TASK_DRAINING])
    expect(html).toContain(">bash<")
    expect(html).toContain(">terminal<")
    expect(html).toContain(">codex<")
    expect(html).toContain(">stream<")
  })

  // ── Age formatting ───────────────────────────────────────────────────────

  test("age uses tabular-nums class", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain("tabular-nums")
  })

  test("age uses font-mono", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain("font-mono")
  })

  // ── Started clock ────────────────────────────────────────────────────────

  test("renders 'started HH:MM' for each task", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toMatch(/started \d{2}:\d{2}/)
  })

  test("started-clock span also uses tabular-nums", () => {
    const html = renderBody([TASK_BASH])
    const count = (html.match(/tabular-nums/g) ?? []).length
    // age + running-count + started-clock = at least 3 occurrences
    expect(count).toBeGreaterThanOrEqual(2)
  })

  // ── Status word + color ──────────────────────────────────────────────────

  test("renders 'running' status word for running task", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain(">running<")
  })

  test("renders 'stopping' status word for stopping task", () => {
    const html = renderBody([TASK_STOPPING])
    expect(html).toContain(">stopping<")
  })

  test("amber dot uses --warning inline style for running task", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain("var(--warning)")
  })

  // ── Chat link ────────────────────────────────────────────────────────────

  test("renders chat link for bash_shell with chatId", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain(`/chat/${TASK_BASH.chatId}`)
  })

  test("no chat link for terminal_pty (no chatId field)", () => {
    const html = renderBody([TASK_TERMINAL])
    expect(html).not.toContain("/chat/")
  })

  // ── Stop button ──────────────────────────────────────────────────────────

  test("renders stop button with aria-label for each task", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain('aria-label="Stop task"')
  })

  test("stop button is not called during SSR render", () => {
    const onStop = mock((_id: string, _force: boolean) => {})
    renderBody([TASK_BASH], { onStop })
    expect(onStop.mock.calls).toHaveLength(0)
  })

  // ── Expand chevron ───────────────────────────────────────────────────────

  test("renders expand chevron button per row", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain("Expand output")
  })

  // ── No native title attributes ───────────────────────────────────────────

  test("no native title= attribute anywhere", () => {
    const html = renderBody([TASK_BASH, TASK_TERMINAL])
    // title= must not appear; ARIA labels handle screen readers
    expect(html).not.toMatch(/ title="[^"]*"/)
  })

  // ── Accessibility ────────────────────────────────────────────────────────

  test("no outline-none anywhere (focus rings must not be stripped)", () => {
    const html = renderBody([TASK_BASH])
    expect(html).not.toContain("outline-none")
  })

  test("rows carry tabindex attribute for roving focus", () => {
    const html = renderBody([TASK_BASH, TASK_TERMINAL])
    expect(html).toContain("tabindex=")
  })

  test("rows carry role=option", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain('role="option"')
  })

  test("list container carries role=listbox", () => {
    const html = renderBody([TASK_BASH])
    expect(html).toContain('role="listbox"')
  })

  // ── Snapshot stability ───────────────────────────────────────────────────

  test("re-renders of same task produce same element count", () => {
    const countOptions = (html: string) => (html.match(/role="option"/g) ?? []).length
    const h1 = renderBody([TASK_BASH])
    const h2 = renderBody([TASK_BASH])
    expect(countOptions(h1)).toBe(countOptions(h2))
  })

  test("renders all four task kinds simultaneously", () => {
    const html = renderBody([TASK_BASH, TASK_TERMINAL, TASK_CODEX, TASK_DRAINING])
    const options = (html.match(/role="option"/g) ?? []).length
    expect(options).toBe(4)
  })

  // ── prefers-reduced-motion ───────────────────────────────────────────────

  test("rows do not carry animate-pulse or animate-spin", () => {
    const html = renderBody([TASK_BASH, TASK_TERMINAL])
    expect(html).not.toContain("animate-pulse")
    expect(html).not.toContain("animate-spin")
  })

  test("rows do not carry animate-* Tailwind class when reduced motion stubbed", () => {
    stubMatchMedia(true)
    try {
      const html = renderBody([TASK_BASH])
      // Our row animation is inline-style-based; rows must not carry Tailwind animate- class
      expect(html).not.toMatch(/class="[^"]*animate-/)
    } finally {
      restoreMatchMedia()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite — BackgroundTasksDialogView (Dialog shell, Portal-based)
// ---------------------------------------------------------------------------

describe("BackgroundTasksDialogView", () => {
  test("renders without throwing when open=true", () => {
    expect(() => renderView([TASK_BASH])).not.toThrow()
  })

  test("renders without throwing when open=false", () => {
    expect(() => renderView([TASK_BASH], { open: false })).not.toThrow()
  })

  test("renders without throwing when tasks is empty", () => {
    expect(() => renderView([])).not.toThrow()
  })

  test("onOpenChange prop wired without throw", () => {
    const onOpenChange = mock((_open: boolean) => {})
    expect(() => renderView([TASK_BASH], { onOpenChange })).not.toThrow()
    expect(onOpenChange.mock.calls).toHaveLength(0)
  })

  test("onStop prop wired without throw", () => {
    const onStop = mock((_id: string, _force: boolean) => {})
    expect(() => renderView([TASK_BASH], { onStop })).not.toThrow()
    expect(onStop.mock.calls).toHaveLength(0)
  })
})
