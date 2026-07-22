import { describe, expect, test } from "bun:test"
import {
  buildAttachmentHintText,
  buildPromptText,
  buildSteeredMessageContent,
  isPromptTooLongMessage,
  isNoConversationFoundMessage,
  toSdkEffort,
  backgroundTaskIdsFromToolResult,
  positiveIntegerFromEnv,
} from "./claude-prompt-helpers"
import type { ChatAttachment } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: "att-1",
    kind: "file",
    mimeType: "text/plain",
    absolutePath: "/home/user/notes.txt",
    relativePath: "notes.txt",
    contentUrl: "file:///home/user/notes.txt",
    size: 42,
    displayName: "notes.txt",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildAttachmentHintText
// ---------------------------------------------------------------------------

describe("buildAttachmentHintText", () => {
  test("returns empty string when no attachments", () => {
    expect(buildAttachmentHintText([])).toBe("")
  })

  test("wraps a single attachment in kanna-attachments XML", () => {
    const result = buildAttachmentHintText([makeAttachment()])
    expect(result).toContain("<kanna-attachments>")
    expect(result).toContain("</kanna-attachments>")
    expect(result).toContain('<attachment kind="file"')
    expect(result).toContain('mime_type="text/plain"')
    expect(result).toContain('path="/home/user/notes.txt"')
    expect(result).toContain('project_path="notes.txt"')
    expect(result).toContain('size_bytes="42"')
    expect(result).toContain('display_name="notes.txt"')
  })

  test("escapes XML special chars in attribute values", () => {
    const result = buildAttachmentHintText([
      makeAttachment({
        displayName: 'a&b"c<d>e',
        absolutePath: "/tmp/test",
        relativePath: "test",
      }),
    ])
    expect(result).toContain("a&amp;b&quot;c&lt;d&gt;e")
    expect(result).not.toContain('a&b"c<d>e')
  })

  test("produces one attachment element per attachment", () => {
    const result = buildAttachmentHintText([makeAttachment(), makeAttachment({ displayName: "second.txt" })])
    const matches = result.match(/<attachment /g)
    expect(matches?.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// buildPromptText
// ---------------------------------------------------------------------------

describe("buildPromptText", () => {
  test("returns trimmed content when no attachments", () => {
    expect(buildPromptText("  hello  ", [])).toBe("hello")
  })

  test("appends attachment hint when attachments are present", () => {
    const result = buildPromptText("Look at this", [makeAttachment()])
    expect(result).toContain("Look at this")
    expect(result).toContain("<kanna-attachments>")
  })

  test("uses fallback text when content is blank but attachments present", () => {
    const result = buildPromptText("   ", [makeAttachment()])
    expect(result).toContain("Please inspect the attached files.")
    expect(result).toContain("<kanna-attachments>")
  })
})

// ---------------------------------------------------------------------------
// buildSteeredMessageContent
// ---------------------------------------------------------------------------

describe("buildSteeredMessageContent", () => {
  test("prepends STEERED_MESSAGE_PREFIX to non-empty content", () => {
    const result = buildSteeredMessageContent("keep going")
    expect(result).toContain("<system-message>")
    expect(result).toContain("keep going")
    // prefix appears before user content
    expect(result.indexOf("<system-message>")).toBeLessThan(result.indexOf("keep going"))
  })

  test("returns just the prefix for empty content", () => {
    const result = buildSteeredMessageContent("")
    expect(result).toContain("<system-message>")
    expect(result).toContain("</system-message>")
    // no trailing content after closing tag
    const afterTag = result.slice(result.lastIndexOf("</system-message>") + "</system-message>".length)
    expect(afterTag.trim()).toBe("")
  })

  test("returns just the prefix for whitespace-only content", () => {
    const result = buildSteeredMessageContent("   ")
    expect(result.indexOf("</system-message>")).toBeGreaterThan(0)
    const afterTag = result.slice(result.lastIndexOf("</system-message>") + "</system-message>".length)
    expect(afterTag.trim()).toBe("")
  })
})

// ---------------------------------------------------------------------------
// isPromptTooLongMessage
// ---------------------------------------------------------------------------

describe("isPromptTooLongMessage", () => {
  test("detects 'prompt is too long'", () => {
    expect(isPromptTooLongMessage("The prompt is too long for this model")).toBe(true)
  })

  test("detects 'prompt too large'", () => {
    expect(isPromptTooLongMessage("prompt too large to process")).toBe(true)
  })

  test("returns false for unrelated messages", () => {
    expect(isPromptTooLongMessage("Something else entirely")).toBe(false)
    expect(isPromptTooLongMessage("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isNoConversationFoundMessage
// ---------------------------------------------------------------------------

describe("isNoConversationFoundMessage", () => {
  test("detects the session-id error string", () => {
    expect(isNoConversationFoundMessage("No conversation found with session ID abc123")).toBe(true)
  })

  test("is case-insensitive", () => {
    expect(isNoConversationFoundMessage("no conversation found with session id XYZ")).toBe(true)
  })

  test("returns false for unrelated strings", () => {
    expect(isNoConversationFoundMessage("session not found")).toBe(false)
    expect(isNoConversationFoundMessage("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// toSdkEffort
// ---------------------------------------------------------------------------

describe("toSdkEffort", () => {
  test.each(["low", "medium", "high", "xhigh", "max"] as const)("maps '%s' to itself", (effort) => {
    expect(toSdkEffort(effort)).toBe(effort)
  })

  test("returns undefined for undefined input", () => {
    expect(toSdkEffort(undefined)).toBeUndefined()
  })

  test("returns undefined for unknown string", () => {
    expect(toSdkEffort("ultra")).toBeUndefined()
    expect(toSdkEffort("")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// backgroundTaskIdsFromToolResult
// ---------------------------------------------------------------------------

describe("backgroundTaskIdsFromToolResult", () => {
  test("extracts id from string content", () => {
    const ids = backgroundTaskIdsFromToolResult("Command running in background with ID: abc123")
    expect(ids).toEqual(["abc123"])
  })

  test("extracts multiple ids from string content", () => {
    const ids = backgroundTaskIdsFromToolResult(
      "Command running in background with ID: aa1\nCommand running in background with ID: bb2",
    )
    expect(ids).toEqual(["aa1", "bb2"])
  })

  test("extracts id from content-block array", () => {
    const blocks = [{ type: "text", text: "Command running in background with ID: xyz99" }]
    expect(backgroundTaskIdsFromToolResult(blocks)).toEqual(["xyz99"])
  })

  test("returns empty array when no match", () => {
    expect(backgroundTaskIdsFromToolResult("no task here")).toEqual([])
    expect(backgroundTaskIdsFromToolResult([])).toEqual([])
  })

  test("returns empty array for non-string/non-array input", () => {
    expect(backgroundTaskIdsFromToolResult(null)).toEqual([])
    expect(backgroundTaskIdsFromToolResult(42)).toEqual([])
  })

  // Real AgentTool background-launch payload captured from a live 0.3.215
  // transcript (chat dd05b76e, 2026-07-22): the reaper killed a session while
  // this launch's agent was mid-flight because the id was never armed.
  test("extracts agentId from Agent background-launch result", () => {
    const text =
      "Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\n" +
      "agentId: a6de6ce841521b5df (internal ID - do not mention to user. Use SendMessage with to: 'a6de6ce841521b5df' to continue this agent.)\n" +
      "The agent is working in the background. You will be notified automatically when it completes."
    expect(backgroundTaskIdsFromToolResult(text)).toEqual(["a6de6ce841521b5df"])
  })

  test("extracts agentId from Agent launch in content-block array", () => {
    const blocks = [{ type: "text", text: "Async agent launched successfully.\nagentId: a0e6405fdd8aa967a (internal ID)" }]
    expect(backgroundTaskIdsFromToolResult(blocks)).toEqual(["a0e6405fdd8aa967a"])
  })

  test("does not extract agentId-like text without the launch marker", () => {
    expect(backgroundTaskIdsFromToolResult("the config field agentId: abc123 is deprecated")).toEqual([])
  })

  test("extracts both bash and agent ids from mixed content", () => {
    const text =
      "Command running in background with ID: bsh1\n" +
      "Async agent launched successfully.\nagentId: a17777d9e3cf9a6a3 (internal ID)"
    expect(backgroundTaskIdsFromToolResult(text)).toEqual(["bsh1", "a17777d9e3cf9a6a3"])
  })
})

// ---------------------------------------------------------------------------
// positiveIntegerFromEnv
// ---------------------------------------------------------------------------

describe("positiveIntegerFromEnv", () => {
  test("returns fallback for undefined", () => {
    expect(positiveIntegerFromEnv(undefined, 5)).toBe(5)
  })

  test("returns fallback for empty string", () => {
    expect(positiveIntegerFromEnv("", 5)).toBe(5)
    expect(positiveIntegerFromEnv("   ", 5)).toBe(5)
  })

  test("returns parsed value for valid positive integer", () => {
    expect(positiveIntegerFromEnv("10", 5)).toBe(10)
    expect(positiveIntegerFromEnv("1", 5)).toBe(1)
  })

  test("returns fallback for zero", () => {
    expect(positiveIntegerFromEnv("0", 5)).toBe(5)
  })

  test("returns fallback for negative integer", () => {
    expect(positiveIntegerFromEnv("-3", 5)).toBe(5)
  })

  test("returns fallback for non-integer float", () => {
    expect(positiveIntegerFromEnv("3.14", 5)).toBe(5)
  })

  test("returns fallback for non-numeric string", () => {
    expect(positiveIntegerFromEnv("abc", 5)).toBe(5)
  })
})
