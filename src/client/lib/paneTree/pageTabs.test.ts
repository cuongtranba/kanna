import { describe, expect, test } from "bun:test"
import { fallbackPathAfterClose, resolvePageRoute } from "./pageTabs"
import { createDefaultLayout, createPane, createTab } from "./tree"
import type { PaneLayout, PaneTabTarget } from "./types"

function layoutOf(targets: PaneTabTarget[], focusedIndex: number | null): PaneLayout {
  const tabs = targets.map((target) => createTab(target, 0))
  const focused = focusedIndex === null ? null : (tabs[focusedIndex]?.tabId ?? null)
  return { root: createPane("main", tabs, focused), focusedPaneId: "main" }
}

const chat = (chatId: string): PaneTabTarget => ({ kind: "chat", chatId })
const settings: PaneTabTarget = { kind: "page", page: "settings", path: "/settings/models" }
const cron: PaneTabTarget = { kind: "page", page: "cron", path: "/cron" }

describe("resolvePageRoute", () => {
  test("maps every page URL to its kind and params", () => {
    expect(resolvePageRoute("/")).toEqual({ page: "projects", params: {} })
    expect(resolvePageRoute("/settings/models")).toEqual({ page: "settings", params: { sectionId: "models" } })
    expect(resolvePageRoute("/cron")).toEqual({ page: "cron", params: {} })
    expect(resolvePageRoute("/workflows/c1")).toEqual({ page: "workflows", params: { chatId: "c1" } })
    expect(resolvePageRoute("/boards/p1")).toEqual({ page: "boards", params: { projectId: "p1" } })
  })

  test("reads /boards/stack/x as a stack, not a project called stack", () => {
    expect(resolvePageRoute("/boards/stack/s1")).toEqual({ page: "boards", params: { stackId: "s1" } })
  })

  test("leaves chat and single-board routes to their own tab kinds", () => {
    expect(resolvePageRoute("/chat/c1")).toBeNull()
    expect(resolvePageRoute("/boards/p1/b1")).toBeNull()
    expect(resolvePageRoute("/boards/stack/s1/b1")).toBeNull()
  })
})

describe("fallbackPathAfterClose", () => {
  test("goes to the focused tab, whether a chat or a page", () => {
    expect(fallbackPathAfterClose(layoutOf([chat("a"), settings], 0))).toBe("/chat/a")
    expect(fallbackPathAfterClose(layoutOf([chat("a"), settings], 1))).toBe("/settings/models")
  })

  test("prefers any chat over any page when the focused tab has no URL", () => {
    const terminal: PaneTabTarget = { kind: "terminal", terminalId: "t1" }
    expect(fallbackPathAfterClose(layoutOf([cron, terminal, chat("b")], 1))).toBe("/chat/b")
    expect(fallbackPathAfterClose(layoutOf([terminal, cron], 0))).toBe("/cron")
  })

  test("returns home when nothing navigable remains", () => {
    expect(fallbackPathAfterClose(createDefaultLayout())).toBe("/")
  })
})
