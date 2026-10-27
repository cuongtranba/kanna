import { describe, expect, test } from "vite-plus/test"
import { formatRepoSlug, parseRepoSlug, sameRepoSlug, sourceRefKey, sourceRefLabel, sourceRefRepoSlug } from "./repo-slug"

describe("parseRepoSlug", () => {
  test("reads the forms a person actually has to hand", () => {
    const expected = { owner: "cuongtranba", repo: "kanna" }
    expect(parseRepoSlug("cuongtranba/kanna")).toEqual(expected)
    expect(parseRepoSlug("  cuongtranba/kanna  ")).toEqual(expected)
    expect(parseRepoSlug("https://github.com/cuongtranba/kanna")).toEqual(expected)
    expect(parseRepoSlug("https://github.com/cuongtranba/kanna.git")).toEqual(expected)
    expect(parseRepoSlug("git@github.com:cuongtranba/kanna.git")).toEqual(expected)
    expect(parseRepoSlug("ssh://git@github.com/cuongtranba/kanna")).toEqual(expected)
  })

  test("refuses rather than guessing", () => {
    expect(parseRepoSlug("")).toBeNull()
    expect(parseRepoSlug("kanna")).toBeNull()
    expect(parseRepoSlug("a/b/c")).toBeNull()
    expect(parseRepoSlug("owner/")).toBeNull()
    expect(parseRepoSlug("own er/kanna")).toBeNull()
    expect(parseRepoSlug("https://gitlab.com/owner/repo")).toBeNull()
  })
})

describe("sourceRefKey", () => {
  test("is the same string whatever order the ref was built in", () => {
    const forward = sourceRefKey({ provider: "github-issues", owner: "o", repo: "r" })
    const reversed = sourceRefKey({ repo: "r", owner: "o", provider: "github-issues" })
    expect(reversed).toBe(forward)
    expect(forward).toBe('{"provider":"github-issues","owner":"o","repo":"r"}')
  })

  test("a project ref keys on its owner, number and node id", () => {
    expect(
      sourceRefKey({ projectId: "PVT_1", projectNumber: 3, owner: "o", provider: "github-projectv2" }),
    ).toBe('{"provider":"github-projectv2","owner":"o","projectNumber":3,"projectId":"PVT_1"}')
  })
})

describe("slug formatting", () => {
  test("formats and compares owner/repo", () => {
    expect(formatRepoSlug({ owner: "o", repo: "r" })).toBe("o/r")
    expect(sameRepoSlug({ owner: "o", repo: "r" }, { owner: "o", repo: "r" })).toBe(true)
    expect(sameRepoSlug({ owner: "o", repo: "r" }, { owner: "o", repo: "x" })).toBe(false)
  })

  test("only an issues ref has a repo slug", () => {
    expect(sourceRefRepoSlug({ provider: "github-issues", owner: "o", repo: "r" })).toBe("o/r")
    expect(
      sourceRefRepoSlug({ provider: "github-projectv2", owner: "o", projectNumber: 3, projectId: "P" }),
    ).toBeNull()
    expect(
      sourceRefLabel({ provider: "github-projectv2", owner: "o", projectNumber: 3, projectId: "P" }),
    ).toBe("o/#3")
  })
})
