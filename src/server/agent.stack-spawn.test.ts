import { describe, expect, test } from "bun:test"
import { resolveSpawnPaths, resolveStackProjects } from "./agent"

describe("resolveSpawnPaths", () => {
  test("solo chat returns fallback cwd, no additionalDirectories", () => {
    const result = resolveSpawnPaths({ id: "c1", stackBindings: undefined } as any, "/proj")
    expect(result).toEqual({ cwd: "/proj", additionalDirectories: [] })
  })

  test("stack chat returns primary path as cwd and peer paths as additionalDirectories", () => {
    const result = resolveSpawnPaths(
      {
        id: "c1",
        stackBindings: [
          { projectId: "p1", worktreePath: "/be", role: "primary" },
          { projectId: "p2", worktreePath: "/fe", role: "additional" },
        ],
      } as any,
      "/fallback",
    )
    expect(result).toEqual({ cwd: "/be", additionalDirectories: ["/fe"] })
  })

  test("missing primary throws", () => {
    expect(() =>
      resolveSpawnPaths(
        {
          id: "c1",
          stackBindings: [{ projectId: "p1", worktreePath: "/be", role: "additional" }],
        } as any,
        "/fallback",
      ),
    ).toThrow(/no primary/u)
  })
})

describe("resolveStackProjects", () => {
  const titles: Record<string, string> = { p1: "Backend API", p2: "Web Client" }
  const lookup = (id: string): string | undefined => titles[id]

  test("solo chat (no bindings) resolves to empty list", () => {
    expect(resolveStackProjects({ stackBindings: undefined } as any, lookup)).toEqual([])
  })

  test("resolves each binding's project title, role, and path from the lookup", () => {
    const out = resolveStackProjects(
      {
        stackBindings: [
          { projectId: "p1", worktreePath: "/be", role: "primary" },
          { projectId: "p2", worktreePath: "/fe", role: "additional" },
        ],
      } as any,
      lookup,
    )
    expect(out).toEqual([
      { projectId: "p1", projectTitle: "Backend API", worktreePath: "/be", role: "primary", projectStatus: "active" },
      { projectId: "p2", projectTitle: "Web Client", worktreePath: "/fe", role: "additional", projectStatus: "active" },
    ])
  })

  test("falls back to '(missing)' + missing status when the project is gone", () => {
    const out = resolveStackProjects(
      { stackBindings: [{ projectId: "gone", worktreePath: "/x", role: "primary" }] } as any,
      lookup,
    )
    expect(out).toEqual([
      { projectId: "gone", projectTitle: "(missing)", worktreePath: "/x", role: "primary", projectStatus: "missing" },
    ])
  })
})
