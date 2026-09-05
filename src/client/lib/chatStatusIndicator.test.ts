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

  test("live state outranks unread", () => {
    expect(chatStatusIndicator({ status: "running", unread: true })?.tone).toBe("warning")
    expect(chatStatusIndicator({ status: "failed", unread: true })?.tone).toBe("destructive")
  })

  test("every indicator names its status", () => {
    expect(chatStatusIndicator({ status: "running", unread: false })?.label).toBe("Running")
    expect(chatStatusIndicator({ status: "waiting_for_user", unread: false })?.label).toBe("Waiting")
    expect(chatStatusIndicator({ status: "failed", unread: false })?.label).toBe("Failed")
    expect(chatStatusIndicator({ status: "idle", unread: true })?.label).toBe("Unread")
  })
})

describe("dot classes", () => {
  test("a fill resolves to the raw theme token", () => {
    expect(chatDotBgClass("warning")).toBe("bg-warning")
    expect(chatDotBgClass("info")).toBe("bg-info")
    expect(chatDotBgClass("success")).toBe("bg-success")
    expect(chatDotBgClass("destructive")).toBe("bg-destructive")
  })

  test("ink resolves to the AA-checked variant, never the raw token", () => {
    for (const tone of ["warning", "info", "success", "destructive"] as const) {
      expect(chatDotTextClass(tone)).toBe(`text-${tone}-text`)
      expect(chatDotTextClass(tone)).not.toBe(`text-${tone}`)
    }
  })

  test("no tone paints no dot but still tints its text muted", () => {
    expect(chatDotBgClass(null)).toBe("")
    expect(chatDotTextClass(null)).toBe("text-muted-foreground")
  })
})

describe("sessionStateBadge", () => {
  test("gives each live lifecycle state a distinct drawn mark", () => {
    const kinds = (["active", "warming", "idle", "cooling"] as const).map(
      (state) => sessionStateBadge(state)?.kind,
    )
    expect(kinds).toEqual(["filled", "half", "ring", "dashed"])
    expect(new Set(kinds).size).toBe(4)
  })

  test("tints active sage and warming amber, in the AA-checked inks", () => {
    expect(sessionStateBadge("active")?.toneClass).toBe("text-success-text")
    expect(sessionStateBadge("warming")?.toneClass).toBe("text-warning-text")
  })

  test("a cold or unknown session draws nothing", () => {
    expect(sessionStateBadge("cold")).toBeNull()
    expect(sessionStateBadge(undefined)).toBeNull()
  })
})
