import { describe, expect, test } from "bun:test"
import { linkifyTextRefs } from "./linkifyTextRefs"

describe("linkifyTextRefs", () => {
  test("no-op when no #", () => {
    const t = "See https://example.com for details"
    expect(linkifyTextRefs(t)).toBe(t)
  })

  test("no-op when no URL", () => {
    const t = "Fix PR #123 and close #456"
    expect(linkifyTextRefs(t)).toBe(t)
  })

  test("PR #NNN + URL on same line", () => {
    const result = linkifyTextRefs(
      "PR #333 is open at https://github.com/repo/pull/333",
    )
    expect(result).toBe(
      "[PR #333](https://github.com/repo/pull/333) is open at https://github.com/repo/pull/333",
    )
  })

  test("issue #NNN where number is in URL path", () => {
    const result = linkifyTextRefs(
      "See issue #42 at https://github.com/repo/issues/42.",
    )
    expect(result).toBe(
      "See [issue #42](https://github.com/repo/issues/42) at https://github.com/repo/issues/42.",
    )
  })

  test("#NNN matched by path segment priority", () => {
    const result = linkifyTextRefs(
      "Review #99 https://github.com/org/repo/pull/99 or #100 https://example.com/100",
    )
    expect(result).toBe(
      "Review [#99](https://github.com/org/repo/pull/99) https://github.com/org/repo/pull/99 or [#100](https://example.com/100) https://example.com/100",
    )
  })

  test("keyword variants: fix, closes, resolves", () => {
    const r1 = linkifyTextRefs("fixes #7 https://github.com/r/issues/7")
    expect(r1).toContain("[fixes #7](https://github.com/r/issues/7)")

    const r2 = linkifyTextRefs("closes #8 https://github.com/r/issues/8")
    expect(r2).toContain("[closes #8](https://github.com/r/issues/8)")

    const r3 = linkifyTextRefs("resolves #9 https://github.com/r/issues/9")
    expect(r3).toContain("[resolves #9](https://github.com/r/issues/9)")
  })

  test("does not double-wrap already linked refs", () => {
    const t = "[PR #333](https://github.com/repo/pull/333) is merged"
    expect(linkifyTextRefs(t)).toBe(t)
  })

  test("skips refs inside fenced code blocks", () => {
    const t = "```\nPR #1 https://example.com/1\n```"
    expect(linkifyTextRefs(t)).toBe(t)
  })

  test("tilde fences also skipped", () => {
    const t = "~~~\n#5 https://example.com/5\n~~~"
    expect(linkifyTextRefs(t)).toBe(t)
  })

  test("handles multiple refs on different lines", () => {
    const t = [
      "PR #10 https://github.com/r/pull/10",
      "issue #20 https://github.com/r/issues/20",
    ].join("\n")
    const result = linkifyTextRefs(t)
    expect(result).toContain("[PR #10](https://github.com/r/pull/10)")
    expect(result).toContain("[issue #20](https://github.com/r/issues/20)")
  })

  test("sentence boundary blocks right-side URL match (Priority B only)", () => {
    // Period+space between ref and URL triggers sentence-boundary block (Priority B).
    // URL must NOT contain the number (which would trigger Priority A and bypass the check).
    const t = "#42 done. https://example.com/dashboard"
    expect(linkifyTextRefs(t)).toBe(t)
  })

  test("trailing punctuation stripped from URL before linking", () => {
    const result = linkifyTextRefs("PR #1 see https://example.com/pull/1.")
    expect(result).toContain("[PR #1](https://example.com/pull/1)")
    // trailing dot stays outside the markdown link
    expect(result).toContain("https://example.com/pull/1.")
  })

  test("returns original string unchanged when nothing transforms", () => {
    const t = "No refs or URLs here at all"
    expect(linkifyTextRefs(t)).toBe(t)
  })
})
