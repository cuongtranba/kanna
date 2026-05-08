import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { BackgroundTasksIndicatorView } from "./BackgroundTasksIndicator"
import { TooltipProvider } from "../ui/tooltip"

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function render(count: number, onOpen: () => void = () => {}) {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null,
      createElement(BackgroundTasksIndicatorView, { count, onOpen })
    )
  )
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BackgroundTasksIndicatorView", () => {
  test("renders count=0 correctly", () => {
    const html = render(0)
    expect(html).toContain(">0<")
  })

  test("renders count > 0 correctly", () => {
    const html = render(3)
    expect(html).toContain(">3<")
  })

  test("uses tabular-nums class for count", () => {
    const html = render(0)
    expect(html).toContain("tabular-nums")
  })

  test("uses font-mono class for count", () => {
    const html = render(0)
    expect(html).toContain("font-mono")
  })

  test("dot uses --warning color when count > 0", () => {
    const html = render(2)
    expect(html).toContain("var(--warning)")
  })

  test("dot uses --muted-foreground color when count = 0", () => {
    const html = render(0)
    expect(html).toContain("var(--muted-foreground)")
    expect(html).not.toContain("var(--warning)")
  })

  test("no native title attribute — uses Tooltip component instead", () => {
    const html = render(0)
    expect(html).not.toContain('title=')
  })

  test("tooltip label includes count and shortcut when count > 0", () => {
    const html = render(1)
    expect(html).toContain("1 background task")
    expect(html).toContain("⌘⇧B")
  })

  test("tooltip label says 'No background tasks' when count = 0", () => {
    const html = render(0)
    expect(html).toContain("No background tasks")
    expect(html).toContain("⌘⇧B")
  })

  test("tooltip label uses plural 'tasks' when count > 1", () => {
    const html = render(2)
    expect(html).toContain("2 background tasks")
  })

  test("tooltip label uses singular 'task' when count = 1", () => {
    const html = render(1)
    expect(html).toContain("1 background task ·")
  })

  test("renders a keyboard-accessible type=button element", () => {
    const html = render(0)
    expect(html).toContain("<button")
    expect(html).toContain('type="button"')
  })

  test("aria-label carries tooltip text for screen readers", () => {
    const htmlActive = render(4)
    expect(htmlActive).toContain('aria-label="4 background tasks · ⌘⇧B"')

    const htmlIdle = render(0)
    expect(htmlIdle).toContain('aria-label="No background tasks · ⌘⇧B"')
  })

  test("onOpen not called during SSR render", () => {
    const onOpen = mock(() => {})
    render(0, onOpen)
    expect(onOpen.mock.calls).toHaveLength(0)
  })

  test("stable structure: count 0 → 3 → 0 both render a button with same shape", () => {
    const html0 = render(0)
    const html3 = render(3)
    const htmlBack0 = render(0)

    // All three render a button
    expect(html0).toContain("<button")
    expect(html3).toContain("<button")
    expect(htmlBack0).toContain("<button")

    // Counts differ
    expect(html0).toContain(">0<")
    expect(html3).toContain(">3<")
    expect(htmlBack0).toContain(">0<")
  })

  test("no animate-pulse or animate- classes (no animation per DESIGN.md)", () => {
    const html0 = render(0)
    const html1 = render(1)
    expect(html0).not.toContain("animate-")
    expect(html1).not.toContain("animate-")
  })

  test("no outline-none (DESIGN.md prohibits stripping focus ring without replacement)", () => {
    const html = render(0)
    expect(html).not.toContain("outline-none")
  })
})
