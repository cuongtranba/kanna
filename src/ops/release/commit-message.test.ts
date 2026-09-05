import { describe, expect, test } from "bun:test"
import {
  formatCommitMessageFailure,
  looksLikeLineInitialNesting,
  validateCommitMessage,
} from "./commit-message"

const LOST_COMMIT = [
  "feat(motion): a motion layer for Kanna — eight surfaces, one vocabulary (#1057)",
  "",
  "Every §01 beat length now reads from a token: 200ms → `--motion-row`, 220ms →",
  "`--motion-carry`, 260ms → `--motion-panel`, and the shell's out-and-back is",
  "`calc(2 * var(--motion-carry))`. The handoff names these inline, but a literal",
  "at a call site is precisely the drift its own table exists to prevent.",
  "",
].join("\n")

describe("validateCommitMessage", () => {
  test("rejects the message release-please actually dropped", () => {
    const verdict = validateCommitMessage(LOST_COMMIT)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return

    expect(verdict.reason).toContain("unexpected token '('")
    expect(verdict.offendingLine).toContain("calc(2 * var(--motion-carry))")
  })

  test("accepts an ordinary conventional commit", () => {
    expect(validateCommitMessage("fix(client): stop a double render\n").ok).toBe(true)
  })

  test("accepts a long body with prose, links and single parens", () => {
    const message = [
      "feat(motion): finish the drawer",
      "",
      "The drawer follows the thumb (1:1, un-eased) because easing describes what",
      "happens after a release. See `evaluateSidebarSwipe` for the thresholds.",
      "",
      "Gates: typecheck, lint, check:arch.",
      "",
    ].join("\n")
    expect(validateCommitMessage(message).ok).toBe(true)
  })

  test("the same nested-paren text is fine once something precedes it", () => {
    const inline = "feat(x): y\n\nsee `calc(2 * var(--a))` here\n"
    expect(validateCommitMessage(inline).ok).toBe(true)

    const lineInitial = "feat(x): y\n\n`calc(2 * var(--a))` here\n"
    expect(validateCommitMessage(lineInitial).ok).toBe(false)
  })

  test("reports a line and column that point into the message", () => {
    const verdict = validateCommitMessage(LOST_COMMIT)
    if (verdict.ok) throw new Error("expected a failure")
    expect(verdict.line).not.toBeNull()
    expect(verdict.column).not.toBeNull()
    const sourceLine = LOST_COMMIT.split("\n")[(verdict.line ?? 1) - 1] ?? ""
    expect(verdict.offendingLine).toBe(sourceLine)
  })
})

describe("looksLikeLineInitialNesting", () => {
  test("recognises the shape that actually breaks the parser", () => {
    expect(looksLikeLineInitialNesting("`calc(2 * var(--a))` here")).toBe(true)
    expect(looksLikeLineInitialNesting("calc(2 * var(--a))")).toBe(true)
    expect(looksLikeLineInitialNesting('"calc(2 * var(--a))"')).toBe(true)
  })

  test("does not claim the shape when the line merely contains parens", () => {
    expect(looksLikeLineInitialNesting("see `calc(2 * var(--a))` here")).toBe(false)
    expect(looksLikeLineInitialNesting("calc(2) is fine")).toBe(false)
    expect(looksLikeLineInitialNesting("- calc(2 * var(--a))")).toBe(false)
    expect(looksLikeLineInitialNesting("* fix(x): calc(2 * var(--a))")).toBe(false)
    expect(looksLikeLineInitialNesting("ordinary prose")).toBe(false)
    expect(looksLikeLineInitialNesting(null)).toBe(false)
  })
})

describe("formatCommitMessageFailure", () => {
  test("shows the offending text, not just a token position", () => {
    const verdict = validateCommitMessage(LOST_COMMIT)
    if (verdict.ok) throw new Error("expected a failure")
    const report = formatCommitMessageFailure("HEAD", verdict)

    expect(report).toContain("HEAD: release-please cannot parse")
    expect(report).toContain("calc(2 * var(--motion-carry))")
    expect(report).toContain("silently")
  })

  test("adds the line-initial hint only when it applies", () => {
    const withHint = validateCommitMessage("feat(x): y\n\n`calc(2 * var(--a))`\n")
    if (withHint.ok) throw new Error("expected a failure")
    expect(formatCommitMessageFailure("HEAD", withHint)).toContain("STARTS with")

    const noLine = { ok: false as const, reason: "boom", line: null, column: null, offendingLine: null }
    expect(formatCommitMessageFailure("HEAD", noLine)).not.toContain("STARTS with")
  })
})
