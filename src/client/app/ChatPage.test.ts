import { describe, expect, test } from "bun:test"
import { CHAT_PAGE_LAYOUT_ROOT_CLASS } from "./ChatPage"

describe("CHAT_PAGE_LAYOUT_ROOT_CLASS", () => {
  const classes = CHAT_PAGE_LAYOUT_ROOT_CLASS.split(/\s+/)

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
