import { describe, expect, mock, test } from "bun:test"
import {
  createTranscriptTocItems,
  getTranscriptTocLabel,
  hasFileDragTypes,
  scrollTranscriptMessageIntoView,
  shouldShowTranscriptTocPanel,
} from "./ChatPage"

describe("hasFileDragTypes", () => {
  test("returns true when file drags are present", () => {
    expect(hasFileDragTypes(["text/plain", "Files"])).toBe(true)
  })

  test("returns false for non-file drags", () => {
    expect(hasFileDragTypes(["text/plain", "text/uri-list"])).toBe(false)
  })
})

describe("transcript TOC helpers", () => {
  test("uses the first non-empty line for TOC labels", () => {
    expect(getTranscriptTocLabel("\nFirst line\nSecond line")).toBe("First line")
  })

  test("falls back for attachment-only user messages", () => {
    expect(getTranscriptTocLabel("   \n  ")).toBe("(attachment only)")
  })

  test("includes only visible user messages in TOC order", () => {
    expect(createTranscriptTocItems([
      {
        id: "system-1",
        kind: "system_init",
        model: "gpt-5.4",
        tools: [],
        agents: [],
        slashCommands: [],
        mcpServers: [],
        provider: "codex",
        timestamp: new Date().toISOString(),
      },
      {
        id: "user-1",
        kind: "user_prompt",
        content: "First line\nsecond line",
        timestamp: new Date().toISOString(),
      },
      {
        id: "user-2",
        kind: "user_prompt",
        content: "Hidden",
        hidden: true,
        timestamp: new Date().toISOString(),
      },
      {
        id: "user-3",
        kind: "user_prompt",
        content: "",
        attachments: [],
        timestamp: new Date().toISOString(),
      },
    ])).toEqual([
      { id: "user-1", label: "First line", order: 1 },
      { id: "user-3", label: "(attachment only)", order: 2 },
    ])
  })

  test("shows the TOC only above the desktop breakpoint when enabled", () => {
    expect(shouldShowTranscriptTocPanel({ enabled: true, chatAreaWidth: 1200, itemCount: 2 })).toBe(false)
    expect(shouldShowTranscriptTocPanel({ enabled: true, chatAreaWidth: 1201, itemCount: 2 })).toBe(true)
    expect(shouldShowTranscriptTocPanel({ enabled: false, chatAreaWidth: 1400, itemCount: 2 })).toBe(false)
    expect(shouldShowTranscriptTocPanel({ enabled: true, chatAreaWidth: 1400, itemCount: 0 })).toBe(false)
  })

  test("scrolls the transcript container to the selected user message", () => {
    const scrollTo = mock(() => {})
    const container = {
      scrollTop: 200,
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTo,
    }
    const target = {
      getBoundingClientRect: () => ({ top: 420 }),
    }

    scrollTranscriptMessageIntoView(container as never, target as never)

    expect(scrollTo).toHaveBeenCalledWith({
      top: 448,
      behavior: "smooth",
    })
  })
})
