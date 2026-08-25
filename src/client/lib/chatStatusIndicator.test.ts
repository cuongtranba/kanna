import { describe, expect, test } from "bun:test"
import type { KannaStatus } from "../../shared/types"
import {
  chatDotBgClass,
  chatDotTextClass,
  chatStatusIndicator,
  isLiveChatStatus,
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

describe("isLiveChatStatus", () => {
  /**
   * Spelled as an exhaustive table rather than a list of the live three: a new
   * KannaStatus that nobody classifies here becomes a compile error, not a
   * silently-not-live status.
   */
  const LIVE_BY_STATUS = {
    idle: false,
    starting: true,
    running: true,
    waiting_for_user: true,
    failed: false,
  } satisfies Record<KannaStatus, boolean>

  const ALL_STATUSES: readonly KannaStatus[] = [
    "idle",
    "starting",
    "running",
    "waiting_for_user",
    "failed",
  ]

  test("classifies every KannaStatus", () => {
    expect(ALL_STATUSES.length).toBe(Object.keys(LIVE_BY_STATUS).length)
    for (const status of ALL_STATUSES) {
      expect({ status, live: isLiveChatStatus(status) }).toEqual({
        status,
        live: LIVE_BY_STATUS[status],
      })
    }
  })

  /**
   * A codex turn registers as `starting` and only flips to `running` once its
   * system_init arrives — so excluding it here is what left an actively running
   * codex chat showing a stale age instead of a live timer.
   */
  test("starting is live, because a codex turn spends its first seconds there", () => {
    expect(isLiveChatStatus("starting")).toBe(true)
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
