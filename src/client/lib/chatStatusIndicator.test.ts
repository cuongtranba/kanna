import { describe, expect, test } from "bun:test"
import {
  chatDotBgClass,
  chatDotTextClass,
  chatStatusIndicator,
  sessionStateBadge,
} from "./chatStatusIndicator"

describe("chatStatusIndicator", () => {
  test("maps every live status to its tone", () => {
    expect(chatStatusIndicator({ status: "running", unread: false })?.tone).toBe("warning")
    expect(chatStatusIndicator({ status: "starting", unread: false })?.tone).toBe("warning")
    expect(chatStatusIndicator({ status: "waiting_for_user", unread: false })?.tone).toBe("info")
    expect(chatStatusIndicator({ status: "failed", unread: false })?.tone).toBe("destructive")
  })

  test("an idle, read chat has no indicator at all", () => {
    expect(chatStatusIndicator({ status: "idle", unread: false })).toBeNull()
  })

  test("an idle chat with unseen output is the only unread tone", () => {
    expect(chatStatusIndicator({ status: "idle", unread: true })?.tone).toBe("success")
  })

  /**
   * A running chat is running whether or not its output has been read — showing
   * the unread tone there would hide the fact that a turn is in flight.
   */
  test("live state outranks unread", () => {
    expect(chatStatusIndicator({ status: "running", unread: true })?.tone).toBe("warning")
    expect(chatStatusIndicator({ status: "failed", unread: true })?.tone).toBe("destructive")
  })

  /**
   * The label is what keeps the dot legible without colour (DESIGN.md's
   * Color-Plus Rule) — the tab reads it out to screen readers and tooltips.
   */
  test("every indicator names its status", () => {
    expect(chatStatusIndicator({ status: "running", unread: false })?.label).toBe("Running")
    expect(chatStatusIndicator({ status: "waiting_for_user", unread: false })?.label).toBe("Waiting")
    expect(chatStatusIndicator({ status: "failed", unread: false })?.label).toBe("Failed")
    expect(chatStatusIndicator({ status: "idle", unread: true })?.label).toBe("Unread")
  })
})

describe("dot classes", () => {
  test("each tone resolves to a theme token, never a raw colour", () => {
    expect(chatDotBgClass("warning")).toBe("bg-warning")
    expect(chatDotBgClass("info")).toBe("bg-info")
    expect(chatDotBgClass("success")).toBe("bg-success")
    expect(chatDotBgClass("destructive")).toBe("bg-destructive")
    expect(chatDotTextClass("warning")).toBe("text-warning")
  })

  // No tone means no dot, so the background class must contribute nothing —
  // while the text variant still needs a colour for the stamp beside it.
  test("no tone paints no dot but still tints its text muted", () => {
    expect(chatDotBgClass(null)).toBe("")
    expect(chatDotTextClass(null)).toBe("text-muted-foreground")
  })

  /**
   * `muted` is a real tone, not the absence of one: it paints a dot (scheduled
   * work exists) but in the quiet neutral, so it cannot be mistaken for amber's
   * "attention available".
   */
  test("muted paints a dot, in the neutral token", () => {
    expect(chatDotBgClass("muted")).toBe("bg-muted-foreground")
    expect(chatDotTextClass("muted")).toBe("text-muted-foreground")
  })
})

describe("sessionStateBadge", () => {
  test("gives each live lifecycle state a distinct glyph", () => {
    const glyphs = (["active", "warming", "idle", "cooling"] as const).map(
      (state) => sessionStateBadge(state)?.glyph,
    )
    expect(glyphs).toEqual(["●", "◐", "○", "◌"])
    expect(new Set(glyphs).size).toBe(4)
  })

  test("tints active sage and warming amber", () => {
    expect(sessionStateBadge("active")?.toneClass).toBe("text-success")
    expect(sessionStateBadge("warming")?.toneClass).toBe("text-warning")
  })

  // A cold session is the resting state of every chat; drawing it would put a
  // badge on every row and make the badge mean nothing.
  test("a cold or unknown session draws nothing", () => {
    expect(sessionStateBadge("cold")).toBeNull()
    expect(sessionStateBadge(undefined)).toBeNull()
  })
})
