import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { GitWorktree, StackSummary } from "../../../../shared/types"
import { StackChatCreateRow } from "./StackChatCreateRow"

const noopAsync = async () => undefined

function makeWorktree(path: string, isPrimary = false): GitWorktree {
  return {
    path,
    branch: isPrimary ? "main" : "feat/branch",
    sha: "abc1234",
    isPrimary,
    isLocked: false,
  }
}

const STACK: StackSummary = {
  id: "stack-1",
  title: "My Stack",
  projectIds: ["p1", "p2"],
  memberCount: 2,
  createdAt: 0,
  updatedAt: 0,
}

const PROJECTS: Array<{ id: string; title: string; worktrees: GitWorktree[] }> = [
  {
    id: "p1",
    title: "Project Alpha",
    worktrees: [makeWorktree("/repos/alpha", true), makeWorktree("/repos/alpha-feat")],
  },
  {
    id: "p2",
    title: "Project Beta",
    worktrees: [makeWorktree("/repos/beta", true)],
  },
]

function renderRow(): string {
  return renderToStaticMarkup(
    createElement(StackChatCreateRow, {
      stack: STACK,
      projects: PROJECTS,
      onCreate: noopAsync,
      onCancel: () => undefined,
    })
  )
}

describe("StackChatCreateRow", () => {
  test("renders one row per stack member project", () => {
    const html = renderRow()
    expect(html).toContain("Project Alpha")
    expect(html).toContain("Project Beta")
  })

  test("each project row has a worktree select dropdown", () => {
    const html = renderRow()
    // Should have at least two <select elements for the two projects
    const selectCount = (html.match(/<select/g) ?? []).length
    expect(selectCount).toBeGreaterThanOrEqual(2)
  })

  test("each project row has a primary radio input", () => {
    const html = renderRow()
    // Should have radio inputs for both projects
    expect(html).toContain('type="radio"')
    const radioCount = (html.match(/type="radio"/g) ?? []).length
    expect(radioCount).toBeGreaterThanOrEqual(2)
  })

  test("first project is selected as primary by default", () => {
    const html = renderRow()
    // React SSR renders defaultChecked as checked="" on the first radio
    expect(html).toContain("checked")
  })

  test("cancel button has type=button", () => {
    const html = renderRow()
    expect(html).toContain("Cancel")
    const cancelIndex = html.indexOf("Cancel")
    const beforeCancel = html.slice(0, cancelIndex)
    const lastButtonStart = beforeCancel.lastIndexOf("<button")
    const cancelButtonTag = html.slice(lastButtonStart, cancelIndex)
    expect(cancelButtonTag).toContain('type="button"')
  })

  test("single-project stack hides the Primary radio cluster", () => {
    const singleProjectStack: StackSummary = { ...STACK, projectIds: ["p1"], memberCount: 1 }
    const html = renderToStaticMarkup(
      createElement(StackChatCreateRow, {
        stack: singleProjectStack,
        projects: PROJECTS,
        onCreate: noopAsync,
        onCancel: () => undefined,
      })
    )
    expect(html).toContain("Project Alpha")
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain(">Primary<")
  })

  test("project with a single worktree disables its select", () => {
    const html = renderRow()
    const betaIndex = html.indexOf("Project Beta")
    const tail = html.slice(betaIndex)
    const selectStart = tail.indexOf("<select")
    const selectEnd = tail.indexOf(">", selectStart)
    const selectTag = tail.slice(selectStart, selectEnd)
    expect(selectTag).toContain("disabled")
  })

  test("default Create Chat button label is not the submitting variant", () => {
    const html = renderRow()
    expect(html).toContain("Create Chat")
    expect(html).not.toContain("Creating")
  })
})
