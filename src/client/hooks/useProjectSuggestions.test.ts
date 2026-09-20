import { describe, expect, test } from "bun:test"
import type { SidebarData, SidebarProjectGroup } from "../../shared/types"
import { filterProjectSuggestions, projectRowsFromSidebar } from "./useProjectSuggestions"

const PROJECTS = [
  { id: "own", localPath: "/home/cuong/repo/kanna" },
  { id: "wiki", localPath: "/home/cuong/repo/wiki" },
  { id: "api", localPath: "/home/cuong/repo/api" },
]

function group(overrides: Partial<SidebarProjectGroup>): SidebarProjectGroup {
  return {
    groupKey: "g",
    localPath: "/p",
    chats: [],
    previewChats: [],
    olderChats: [],
    defaultCollapsed: false,
    ...overrides,
  }
}

describe("projectRowsFromSidebar", () => {
  test("lists starred groups before regular ones", () => {
    const sidebarData: SidebarData = {
      starredProjectGroups: [group({ groupKey: "s1", localPath: "/a" })],
      projectGroups: [group({ groupKey: "g1", localPath: "/b" })],
      stacks: [],
    }
    expect(projectRowsFromSidebar(sidebarData)).toEqual([
      { id: "s1", localPath: "/a" },
      { id: "g1", localPath: "/b" },
    ])
  })
})

describe("filterProjectSuggestions", () => {
  test("lists every project except the chat's own on a bare @", () => {
    const items = filterProjectSuggestions(PROJECTS, "", "own")
    expect(items.map((item) => item.slug)).toEqual(["api", "wiki"])
  })

  test("still lists everything while the query is a prefix of 'project/'", () => {
    expect(filterProjectSuggestions(PROJECTS, "pro", "own")).toHaveLength(2)
  })

  test("filters by the part after 'project/'", () => {
    const items = filterProjectSuggestions(PROJECTS, "project/wi", "own")
    expect(items.map((item) => item.slug)).toEqual(["wiki"])
  })

  test("matches a bare project name so @wik finds the project", () => {
    const items = filterProjectSuggestions(PROJECTS, "wik", "own")
    expect(items.map((item) => item.slug)).toEqual(["wiki"])
  })

  test("returns nothing for a query that matches no project", () => {
    expect(filterProjectSuggestions(PROJECTS, "zzz", "own")).toEqual([])
  })

  test("carries the path so the picker row can show it", () => {
    const items = filterProjectSuggestions(PROJECTS, "project/api", "own")
    expect(items[0]).toEqual({
      kind: "project",
      projectId: "api",
      slug: "api",
      title: "api",
      localPath: "/home/cuong/repo/api",
    })
  })

  test("keeps every project when the chat belongs to none of them", () => {
    expect(filterProjectSuggestions(PROJECTS, "", null)).toHaveLength(3)
  })

  test("offers the qualified slug when two projects share a basename", () => {
    const items = filterProjectSuggestions(
      [
        { id: "w", localPath: "/home/work/api" },
        { id: "p", localPath: "/home/personal/api" },
      ],
      "",
      null,
    )
    expect(items.map((item) => item.slug)).toEqual(["personal-api", "work-api"])
  })
})
