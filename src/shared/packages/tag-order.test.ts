import { describe, test, expect } from "bun:test"
import { pickLatestSemverTag } from "./tag-order"

describe("pickLatestSemverTag", () => {
  test("picks the highest version, not the first or the lexicographic max", () => {
    expect(pickLatestSemverTag(["v11.9.0", "v11.13.4", "v11.12.0"])).toBe("v11.13.4")
  })

  test("compares numerically, so 11.9.0 loses to 11.13.0", () => {
    expect(pickLatestSemverTag(["v11.9.0", "v11.13.0"])).toBe("v11.13.0")
  })

  // The real cuongtranba/c3-skill tag list: date tags sort above `v11.*`
  // lexicographically, which is why "GitHub's first tag" is the wrong answer.
  test("ignores non-semver tags that would otherwise sort first", () => {
    expect(
      pickLatestSemverTag([
        "v20260102-production-cleanup",
        "v20251230-reference-delegation",
        "v11.13.4",
        "v11.12.0",
      ]),
    ).toBe("v11.13.4")
  })

  test("accepts tags with and without a leading v", () => {
    expect(pickLatestSemverTag(["1.2.3", "v1.2.4"])).toBe("v1.2.4")
    expect(pickLatestSemverTag(["2.0.0"])).toBe("2.0.0")
  })

  test("a release outranks a prerelease of the same version", () => {
    expect(pickLatestSemverTag(["v1.2.3-rc.1", "v1.2.3"])).toBe("v1.2.3")
  })

  test("orders prereleases of the same version among themselves", () => {
    expect(pickLatestSemverTag(["v1.2.3-rc.1", "v1.2.3-rc.2"])).toBe("v1.2.3-rc.2")
  })

  test("returns null when nothing parses as semver", () => {
    expect(pickLatestSemverTag(["latest", "v20260102-production-cleanup"])).toBeNull()
  })

  test("returns null for an empty list", () => {
    expect(pickLatestSemverTag([])).toBeNull()
  })

  test("tolerates surrounding whitespace", () => {
    expect(pickLatestSemverTag([" v1.2.3 "])).toBe(" v1.2.3 ")
  })
})
