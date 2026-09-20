import { describe, expect, test } from "bun:test"
import {
  buildProjectMentionIndex,
  parseProjectMentionSlugs,
  resolveProjectMentions,
} from "./project-mention"

describe("buildProjectMentionIndex", () => {
  test("uses the basename when it is unique", () => {
    const index = buildProjectMentionIndex([
      { id: "p1", localPath: "/home/cuong/repo/kanna" },
      { id: "p2", localPath: "/home/cuong/repo/wiki" },
    ])
    expect(index.slugByProjectId.get("p1")).toBe("kanna")
    expect(index.slugByProjectId.get("p2")).toBe("wiki")
    expect(index.projectIdBySlug.get("kanna")).toBe("p1")
  })

  test("qualifies BOTH sides of a basename collision", () => {
    const index = buildProjectMentionIndex([
      { id: "p1", localPath: "/home/work/api" },
      { id: "p2", localPath: "/home/personal/api" },
    ])
    expect(index.slugByProjectId.get("p1")).toBe("work-api")
    expect(index.slugByProjectId.get("p2")).toBe("personal-api")
    expect(index.projectIdBySlug.has("api")).toBe(false)
  })

  test("falls back to a numeric suffix when the parent also collides", () => {
    const index = buildProjectMentionIndex([
      { id: "p1", localPath: "/one/a/api" },
      { id: "p2", localPath: "/two/a/api" },
    ])
    expect(index.slugByProjectId.get("p1")).toBe("a-api")
    expect(index.slugByProjectId.get("p2")).toBe("a-api-2")
  })

  test("is independent of input order", () => {
    const projects = [
      { id: "p2", localPath: "/home/personal/api" },
      { id: "p1", localPath: "/home/work/api" },
    ]
    const forward = buildProjectMentionIndex(projects)
    const reversed = buildProjectMentionIndex([...projects].reverse())
    expect(forward.slugByProjectId.get("p1")).toBe(reversed.slugByProjectId.get("p1"))
    expect(forward.slugByProjectId.get("p2")).toBe(reversed.slugByProjectId.get("p2"))
  })

  test("normalizes characters that cannot appear in a slug", () => {
    const index = buildProjectMentionIndex([
      { id: "p1", localPath: "/home/cuong/My Project (v2)" },
    ])
    expect(index.slugByProjectId.get("p1")).toBe("my-project-v2")
  })

  test("skips a path with no usable segment", () => {
    const index = buildProjectMentionIndex([{ id: "p1", localPath: "///" }])
    expect(index.slugByProjectId.size).toBe(0)
  })
})

describe("parseProjectMentionSlugs", () => {
  test("reads a mention at the start of the message and after whitespace", () => {
    expect(parseProjectMentionSlugs("@project/kanna look at @project/wiki too")).toEqual([
      "kanna",
      "wiki",
    ])
  })

  test("reads two adjacent mentions separated by one space", () => {
    expect(parseProjectMentionSlugs("@project/a @project/b")).toEqual(["a", "b"])
  })

  test("lowercases what the user typed", () => {
    expect(parseProjectMentionSlugs("@project/Kanna")).toEqual(["kanna"])
  })

  test("ignores a mention glued to preceding text", () => {
    expect(parseProjectMentionSlugs("mail@project/kanna")).toEqual([])
  })

  test("ignores an agent mention and a bare path mention", () => {
    expect(parseProjectMentionSlugs("@agent/blog and @src/index.ts")).toEqual([])
  })
})

describe("resolveProjectMentions", () => {
  const projects = [
    { id: "p1", localPath: "/home/cuong/repo/kanna" },
    { id: "p2", localPath: "/home/cuong/repo/wiki" },
  ]

  test("resolves a slug to its project id", () => {
    expect(resolveProjectMentions("ship @project/wiki", projects)).toEqual({
      projectIds: ["p2"],
      unresolvedSlugs: [],
    })
  })

  test("de-duplicates repeated mentions of one project", () => {
    const result = resolveProjectMentions("@project/kanna and @project/kanna", projects)
    expect(result.projectIds).toEqual(["p1"])
  })

  test("preserves the order the projects were mentioned in", () => {
    const result = resolveProjectMentions("@project/wiki then @project/kanna", projects)
    expect(result.projectIds).toEqual(["p2", "p1"])
  })

  test("reports a slug that matches nothing instead of guessing", () => {
    expect(resolveProjectMentions("@project/ghost", projects)).toEqual({
      projectIds: [],
      unresolvedSlugs: ["ghost"],
    })
  })

  test("resolves a stale bare basename that the index has since qualified", () => {
    const colliding = [
      { id: "p1", localPath: "/home/work/api" },
      { id: "p2", localPath: "/home/personal/api" },
    ]
    expect(resolveProjectMentions("@project/api", colliding).projectIds).toEqual([])
    expect(resolveProjectMentions("@project/api", [colliding[0]!]).projectIds).toEqual(["p1"])
  })

  test("returns nothing for a message with no mention", () => {
    expect(resolveProjectMentions("just a message", projects)).toEqual({
      projectIds: [],
      unresolvedSlugs: [],
    })
  })
})
