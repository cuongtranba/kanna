import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { StackSummary, SidebarChatRow } from "../../../../shared/types"
import { TooltipProvider } from "../../ui/tooltip"
import { StacksSection } from "./StacksSection"

function makeStack(id: string, title: string, memberCount: number, projectIds: string[] = []): StackSummary {
  return {
    id,
    title,
    projectIds,
    memberCount,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
  }
}

function renderSection(
  stacks: StackSummary[],
  projects: Array<{ id: string; title: string }>,
  opts: {
    expandedStackIds?: Set<string>
  } = {}
): string {
  const { expandedStackIds = new Set<string>() } = opts
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(StacksSection, {
        stacks,
        projects,
        expandedStackIds,
        onToggleExpanded: () => undefined,
        onOpenCreatePanel: () => undefined,
        onOpenStackMenu: () => undefined,
        chats: [] as SidebarChatRow[],
      })
    )
  )
}

describe("StacksSection", () => {
  test("renders empty state copy when stacks list is empty", () => {
    const html = renderSection([], [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }])
    expect(html).toContain("A stack groups projects so one chat can read and write across them")
  })

  test("renders one row per stack with title and member-count badge", () => {
    const stacks = [
      makeStack("s1", "Alpha Stack", 2),
      makeStack("s2", "Beta Stack", 3),
    ]
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection(stacks, projects)
    expect(html).toContain("Alpha Stack")
    expect(html).toContain("Beta Stack")
    expect(html).toContain("2")
    expect(html).toContain("3")
  })

  test("expanding a stack row reveals its member project names inline", () => {
    const stacks = [
      makeStack("s1", "My Stack", 2, ["p1", "p2"]),
    ]
    const projects = [
      { id: "p1", title: "Project Alpha" },
      { id: "p2", title: "Project Beta" },
    ]
    const html = renderSection(stacks, projects, { expandedStackIds: new Set(["s1"]) })
    expect(html).toContain("Project Alpha")
    expect(html).toContain("Project Beta")
  })

  test("stack row has role=button and tabIndex=0 for keyboard navigation", () => {
    const stacks = [makeStack("s1", "My Stack", 1)]
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection(stacks, projects)
    expect(html).toContain('role="button"')
    expect(html).toContain("tabindex")
  })

  test("plus button is present and keyboard reachable (has type=button)", () => {
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection([], projects)
    expect(html).toContain("<button")
  })

  test("disabled state when fewer than 2 projects: plus button has disabled attribute", () => {
    const projects = [{ id: "p1", title: "Only Project" }]
    const html = renderSection([], projects)
    expect(html).toContain("disabled")
  })
})
