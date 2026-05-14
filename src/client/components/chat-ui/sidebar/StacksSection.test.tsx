import { describe, expect, test } from "bun:test"
import React, { createElement } from "react"
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
    onStartChat?: (stackId: string) => void
    renderChatCreate?: (stack: StackSummary) => React.ReactNode
  } = {}
): string {
  const { expandedStackIds = new Set<string>(), onStartChat, renderChatCreate } = opts
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
        onStartChat,
        renderChatCreate,
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

  test("each stack row has a menu button for stack actions", () => {
    const stacks = [makeStack("s1", "My Stack", 2)]
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection(stacks, projects)
    expect(html).toContain('aria-label="Stack actions"')
  })

  test("expanded stack with onStartChat shows '+ New chat' button", () => {
    const stacks = [makeStack("s1", "My Stack", 2, ["p1", "p2"])]
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection(stacks, projects, {
      expandedStackIds: new Set(["s1"]),
      onStartChat: () => undefined,
    })
    expect(html).toContain("New chat")
  })

  test("renderChatCreate slot output appears under expanded stack", () => {
    const stacks = [makeStack("s1", "My Stack", 2, ["p1", "p2"])]
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection(stacks, projects, {
      expandedStackIds: new Set(["s1"]),
      onStartChat: () => undefined,
      renderChatCreate: () => createElement("div", { "data-testid": "chat-create-slot" }, "FORM"),
    })
    expect(html).toContain("chat-create-slot")
    expect(html).toContain("FORM")
  })

  test("no '+ New chat' button when onStartChat is undefined", () => {
    const stacks = [makeStack("s1", "My Stack", 2, ["p1", "p2"])]
    const projects = [{ id: "p1", title: "Project A" }, { id: "p2", title: "Project B" }]
    const html = renderSection(stacks, projects, { expandedStackIds: new Set(["s1"]) })
    expect(html).not.toContain("New chat")
  })

  test("renders star asterism separator between adjacent stacks but not above the first", () => {
    const stacks = [
      makeStack("s1", "Alpha", 1),
      makeStack("s2", "Beta", 1),
      makeStack("s3", "Gamma", 1),
    ]
    const projects = [{ id: "p1", title: "P1" }, { id: "p2", title: "P2" }]
    const html = renderSection(stacks, projects)
    const separatorCount = (html.match(/data-testid="stack-separator"/g) ?? []).length
    expect(separatorCount).toBe(2)
    expect(html).toContain("✦ ✦ ✦")
    expect(html).toContain('aria-hidden="true"')
  })

  test("no separator rendered when only one stack exists", () => {
    const stacks = [makeStack("s1", "Solo", 1)]
    const projects = [{ id: "p1", title: "P1" }, { id: "p2", title: "P2" }]
    const html = renderSection(stacks, projects)
    expect(html).not.toContain('data-testid="stack-separator"')
  })
})
