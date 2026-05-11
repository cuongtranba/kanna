import { describe, expect, test } from "bun:test"
import { resolveSpawnPaths } from "./agent"

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
