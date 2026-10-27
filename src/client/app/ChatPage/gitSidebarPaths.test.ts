import { describe, expect, test } from "bun:test"
import { getIgnoreFolderEntryFromDiffPath } from "./gitSidebarPaths"

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
