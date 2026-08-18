import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { MemoryRouter, Route, Routes } from "react-router-dom"

/**
 * Pins the boards route table's disambiguation invariant from `App.tsx`.
 *
 * `/boards/stack/:stackId` and `/boards/:projectId` are both two dynamic-or-
 * literal segments after `/boards`, and `/boards/stack/:stackId/:boardId` and
 * `/boards/:projectId/:boardId` are both three — same segment COUNT, so an
 * ambiguous router could read a Stack path as a project id. react-router
 * scores a literal segment ("stack") above a dynamic one at the same
 * position, so the Stack routes win on their own path space; this test
 * exercises the real `<Routes>` shape from `App.tsx` rather than trusting
 * that scoring by inspection.
 */

function ProjectList() {
  return <div data-testid="project-list" />
}
function Workspace() {
  return <div data-testid="workspace" />
}
function StackList() {
  return <div data-testid="stack-list" />
}

function renderAt(path: string): string {
  const container = document.createElement("div")
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/boards/:projectId" element={<ProjectList />} />
          <Route path="/boards/:projectId/:boardId" element={<Workspace />} />
          <Route path="/boards/stack/:stackId" element={<StackList />} />
          <Route path="/boards/stack/:stackId/:boardId" element={<Workspace />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  const html = container.innerHTML
  act(() => root.unmount())
  return html
}

describe("boards route disambiguation", () => {
  test("/boards/:projectId still resolves to the project list", () => {
    expect(renderAt("/boards/proj-1")).toContain('data-testid="project-list"')
  })

  test("/boards/:projectId/:boardId still resolves to the workspace", () => {
    expect(renderAt("/boards/proj-1/board-1")).toContain('data-testid="workspace"')
  })

  test("/boards/stack/:stackId resolves to the Stack list, not the project list", () => {
    const html = renderAt("/boards/stack/stack-1")
    expect(html).toContain('data-testid="stack-list"')
    expect(html).not.toContain('data-testid="project-list"')
  })

  test("/boards/stack/:stackId/:boardId resolves to the workspace, not the project board list", () => {
    const html = renderAt("/boards/stack/stack-1/board-1")
    expect(html).toContain('data-testid="workspace"')
    expect(html).not.toContain('data-testid="project-list"')
    expect(html).not.toContain('data-testid="stack-list"')
  })
})
