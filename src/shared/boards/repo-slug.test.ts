import { describe, expect, test } from "bun:test"
import { parseRepoSlug } from "./repo-slug"

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
