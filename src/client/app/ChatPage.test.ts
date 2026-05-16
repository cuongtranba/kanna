import { describe, expect, test } from "bun:test"
import {
  CHAT_PAGE_LAYOUT_ROOT_CLASS,
  getIgnoreFolderEntryFromDiffPath,
  hasFileDragTypes,
  shouldUseMobileRightSidebarOverlay,
  shouldAutoFollowTranscriptResize,
} from "./ChatPage"

describe("hasFileDragTypes", () => {
  test("returns true when file drags are present", () => {
    expect(hasFileDragTypes(["text/plain", "Files"])).toBe(true)
  })

  test("returns false for non-file drags", () => {
    expect(hasFileDragTypes(["text/plain", "text/uri-list"])).toBe(false)
  })
})

describe("getIgnoreFolderEntryFromDiffPath", () => {
  test("returns the parent folder with a trailing slash", () => {
    expect(getIgnoreFolderEntryFromDiffPath("tmp/cache/output.log")).toBe("tmp/cache/")
  })

  test("normalizes repeated separators before deriving the folder", () => {
    expect(getIgnoreFolderEntryFromDiffPath("tmp//cache/output.log")).toBe("tmp/cache/")
  })

  test("returns null for repo root files", () => {
    expect(getIgnoreFolderEntryFromDiffPath("scratch.log")).toBeNull()
  })
})

describe("shouldAutoFollowTranscriptResize", () => {
  test("keeps auto-follow enabled while the scroll button is hidden", () => {
    expect(shouldAutoFollowTranscriptResize(false, 0, 1_000)).toBe(true)
  })

  test("keeps auto-follow enabled briefly after chat selection", () => {
    expect(shouldAutoFollowTranscriptResize(true, 2_000, 1_500)).toBe(true)
  })

  test("stops forcing auto-follow after the selection window expires", () => {
    expect(shouldAutoFollowTranscriptResize(true, 2_000, 2_000)).toBe(false)
  })
})

describe("CHAT_PAGE_LAYOUT_ROOT_CLASS", () => {
  const classes = CHAT_PAGE_LAYOUT_ROOT_CLASS.split(/\s+/)

  // Regression: a flex item's automatic min-height is its content size, so
  // without min-h-0 a long transcript expands the layout root past 100dvh.
  // That makes the LegendList scroll container clientHeight === scrollHeight,
  // killing scroll (most visible on mobile). Keep min-h-0.
  test("constrains vertical size so the transcript can scroll", () => {
    expect(classes).toContain("min-h-0")
  })

  test("keeps the flex column shell intact", () => {
    expect(classes).toContain("flex")
    expect(classes).toContain("flex-col")
    expect(classes).toContain("flex-1")
    expect(classes).toContain("min-w-0")
  })
})

describe("shouldUseMobileRightSidebarOverlay", () => {
  test("enables the overlay below the mobile breakpoint", () => {
    expect(shouldUseMobileRightSidebarOverlay(767)).toBe(true)
  })

  test("keeps the desktop split layout at and above the breakpoint", () => {
    expect(shouldUseMobileRightSidebarOverlay(768)).toBe(false)
    expect(shouldUseMobileRightSidebarOverlay(1280)).toBe(false)
  })
})
