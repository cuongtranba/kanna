import { describe, expect, test } from "bun:test"
import { decideMentionedProjectBindings } from "./project-mention-attach"

const PROJECTS = [
  { id: "own", localPath: "/home/cuong/repo/kanna" },
  { id: "wiki", localPath: "/home/cuong/repo/wiki" },
  { id: "api", localPath: "/home/cuong/repo/api" },
]

const allPathsExist = () => true

function decide(text: string, overrides: Partial<Parameters<typeof decideMentionedProjectBindings>[0]> = {}) {
  return decideMentionedProjectBindings({
    text,
    chatProjectId: "own",
    chatLocalPath: "/home/cuong/repo/kanna",
    currentBindings: undefined,
    listProjects: () => PROJECTS,
    pathExists: allPathsExist,
    ...overrides,
  })
}

describe("decideMentionedProjectBindings", () => {
  test("returns null when the message mentions no project", () => {
    expect(decide("fix the login bug")).toBeNull()
  })

  test("never reads the project list for a message with no mention", () => {
    let reads = 0
    decide("fix the login bug", {
      listProjects: () => {
        reads++
        return PROJECTS
      },
    })
    expect(reads).toBe(0)
  })

  test("seeds the chat's own project as primary on the first attach", () => {
    expect(decide("compare with @project/wiki")).toEqual([
      { projectId: "own", worktreePath: "/home/cuong/repo/kanna", role: "primary" },
      { projectId: "wiki", worktreePath: "/home/cuong/repo/wiki", role: "additional" },
    ])
  })

  test("leaves the cwd unchanged by keeping the existing primary", () => {
    const bindings = decide("@project/wiki", {
      currentBindings: [
        { projectId: "own", worktreePath: "/wt/card-7", role: "primary" },
      ],
    })
    expect(bindings?.[0]).toEqual({ projectId: "own", worktreePath: "/wt/card-7", role: "primary" })
  })

  test("appends to existing bindings instead of replacing them", () => {
    const bindings = decide("@project/api", {
      currentBindings: [
        { projectId: "own", worktreePath: "/wt/be", role: "primary" },
        { projectId: "wiki", worktreePath: "/wt/wiki", role: "additional" },
      ],
    })
    expect(bindings?.map((b) => b.projectId)).toEqual(["own", "wiki", "api"])
  })

  test("returns null when every mentioned project is already bound", () => {
    expect(decide("@project/wiki again", {
      currentBindings: [
        { projectId: "own", worktreePath: "/home/cuong/repo/kanna", role: "primary" },
        { projectId: "wiki", worktreePath: "/home/cuong/repo/wiki", role: "additional" },
      ],
    })).toBeNull()
  })

  test("returns null when the chat's own project is the only mention", () => {
    expect(decide("@project/kanna")).toBeNull()
  })

  test("attaches several projects named in one message", () => {
    const bindings = decide("@project/wiki and @project/api")
    expect(bindings?.map((b) => b.projectId)).toEqual(["own", "wiki", "api"])
  })

  test("skips a project whose path is gone from disk", () => {
    expect(decide("@project/wiki", {
      pathExists: (path) => path !== "/home/cuong/repo/wiki",
    })).toBeNull()
  })

  test("skips only the missing project when several are mentioned", () => {
    const bindings = decide("@project/wiki and @project/api", {
      pathExists: (path) => path !== "/home/cuong/repo/wiki",
    })
    expect(bindings?.map((b) => b.projectId)).toEqual(["own", "api"])
  })

  test("returns null for a slug that resolves to nothing", () => {
    expect(decide("@project/ghost")).toBeNull()
  })

  test("does not mutate the bindings it was given", () => {
    const currentBindings = [
      { projectId: "own", worktreePath: "/wt/be", role: "primary" as const },
    ]
    decide("@project/wiki", { currentBindings })
    expect(currentBindings).toHaveLength(1)
  })
})
