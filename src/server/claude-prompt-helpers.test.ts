import { describe, expect, test } from "bun:test"
import {
  buildAttachmentHintText,
  buildPromptText,
  buildSteeredMessageContent,
  isPromptTooLongMessage,
  isNoConversationFoundMessage,
  toSdkEffort,
  backgroundTaskIdsFromToolResult,
  backgroundTaskLaunchesFromToolResult,
  mergeBackgroundTaskSnapshot,
  toolCallDescription,
  positiveIntegerFromEnv,
  findLastUserMessageId,
} from "./claude-prompt-helpers"
import type { ChatAttachment, NormalizedToolCall } from "../shared/types"


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


describe("buildSteeredMessageContent", () => {
  test("prepends STEERED_MESSAGE_PREFIX to non-empty content", () => {
    const result = buildSteeredMessageContent("keep going")
    expect(result).toContain("<system-message>")
    expect(result).toContain("keep going")
    expect(result.indexOf("<system-message>")).toBeLessThan(result.indexOf("keep going"))
  })

  test("returns just the prefix for empty content", () => {
    const result = buildSteeredMessageContent("")
    expect(result).toContain("<system-message>")
    expect(result).toContain("</system-message>")
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


describe("backgroundTaskLaunchesFromToolResult", () => {
  test("extracts id and outputPath from full launch message", () => {
    const text =
      "Command running in background with ID: bgABC123. Output is being written to: /tmp/x.output. You will be notified when it completes."
    expect(backgroundTaskLaunchesFromToolResult(text)).toEqual([
      { id: "bgABC123", outputPath: "/tmp/x.output" },
    ])
  })

  test("extracts id with null outputPath when path is absent", () => {
    expect(backgroundTaskLaunchesFromToolResult("Command running in background with ID: abc123")).toEqual([
      { id: "abc123", outputPath: null },
    ])
  })

  test("extracts multiple launches from the same string", () => {
    const text =
      "Command running in background with ID: t1. Output is being written to: /tmp/t1.output. You will be notified when it completes.\n" +
      "Command running in background with ID: t2. Output is being written to: /tmp/t2.output. You will be notified when it completes."
    expect(backgroundTaskLaunchesFromToolResult(text)).toEqual([
      { id: "t1", outputPath: "/tmp/t1.output" },
      { id: "t2", outputPath: "/tmp/t2.output" },
    ])
  })

  test("extracts from content-block array", () => {
    const blocks = [
      {
        type: "text",
        text: "Command running in background with ID: xyz99. Output is being written to: /tmp/z.output. You will be notified when it completes.",
      },
    ]
    expect(backgroundTaskLaunchesFromToolResult(blocks)).toEqual([
      { id: "xyz99", outputPath: "/tmp/z.output" },
    ])
  })

  test("agent launches have null outputPath", () => {
    const text =
      "Async agent launched successfully.\nagentId: a6de6ce841521b5df (internal ID)"
    const launches = backgroundTaskLaunchesFromToolResult(text)
    expect(launches).toEqual([{ id: "a6de6ce841521b5df", outputPath: null }])
  })

  test("returns empty array for no match", () => {
    expect(backgroundTaskLaunchesFromToolResult("nothing here")).toEqual([])
  })

  test("backgroundTaskIdsFromToolResult still works unchanged", () => {
    const text =
      "Command running in background with ID: bgABC123. Output is being written to: /tmp/x.output. You will be notified when it completes."
    expect(backgroundTaskIdsFromToolResult(text)).toEqual(["bgABC123"])
  })
})


describe("mergeBackgroundTaskSnapshot outputPath preservation", () => {
  test("preserves outputPath from a previous entry when snapshot has no path", () => {
    const previous = new Map([
      ["t1", { taskType: null, description: null, startedAt: 100, outputPath: "/tmp/t1.out" }],
    ])
    const result = mergeBackgroundTaskSnapshot(previous, ["t1"], undefined, 200)
    expect(result.get("t1")?.outputPath).toBe("/tmp/t1.out")
  })

  test("new task not in previous gets null outputPath from snapshot alone", () => {
    const result = mergeBackgroundTaskSnapshot(new Map(), ["t2"], undefined, 200)
    expect(result.get("t2")?.outputPath).toBeNull()
  })
})


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


describe("toolCallDescription", () => {
  test("bash: prefers description, falls back to command", () => {
    const withDescription = {
      kind: "tool",
      toolKind: "bash",
      toolName: "Bash",
      toolId: "t1",
      input: { command: "sleep 600", description: "Watch the deploy" },
    } as unknown as NormalizedToolCall
    expect(toolCallDescription(withDescription)).toBe("Watch the deploy")

    const commandOnly = {
      kind: "tool",
      toolKind: "bash",
      toolName: "Bash",
      toolId: "t2",
      input: { command: "bun test --watch" },
    } as unknown as NormalizedToolCall
    expect(toolCallDescription(commandOnly)).toBe("bun test --watch")
  })

  test("non-bash: reads description off rawInput, null when absent", () => {
    const agentCall = {
      kind: "tool",
      toolKind: "subagent_task",
      toolName: "Agent",
      toolId: "t3",
      input: { subagentType: "general-purpose" },
      rawInput: { description: "Summarise benchmark", prompt: "..." },
    } as unknown as NormalizedToolCall
    expect(toolCallDescription(agentCall)).toBe("Summarise benchmark")

    const bare = {
      kind: "tool",
      toolKind: "glob",
      toolName: "Glob",
      toolId: "t4",
      input: { pattern: "*" },
    } as unknown as NormalizedToolCall
    expect(toolCallDescription(bare)).toBeNull()
  })
})


describe("mergeBackgroundTaskSnapshot", () => {
  test("REPLACE semantics: absent ids drop, new ids appear with snapshot meta", () => {
    const previous = new Map([
      ["gone", { taskType: null, description: "stale", startedAt: 1, outputPath: null }],
      ["kept", { taskType: null, description: null, startedAt: 2, outputPath: null }],
    ])
    const next = mergeBackgroundTaskSnapshot(
      previous,
      ["kept", "fresh"],
      [
        { id: "kept", taskType: "local_bash", description: "CI watch" },
        { id: "fresh", taskType: "local_agent", description: null },
      ],
      1_000,
    )
    expect(next.has("gone")).toBe(false)
    expect(next.get("kept")).toEqual({ taskType: "local_bash", description: "CI watch", startedAt: 2, outputPath: null })
    expect(next.get("fresh")).toEqual({ taskType: "local_agent", description: null, startedAt: 1_000, outputPath: null })
  })

  test("snapshot without meta preserves previously learned labels", () => {
    const previous = new Map([
      ["t1", { taskType: "local_bash", description: "Watch deploy", startedAt: 5, outputPath: null }],
    ])
    const next = mergeBackgroundTaskSnapshot(previous, ["t1"], undefined, 999)
    expect(next.get("t1")).toEqual({ taskType: "local_bash", description: "Watch deploy", startedAt: 5, outputPath: null })
  })
})

describe("findLastUserMessageId", () => {
  test("returns the most recent user_prompt id", () => {
    const messages = [
      { kind: "user_prompt", _id: "m1" },
      { kind: "assistant_text", _id: "m2" },
      { kind: "user_prompt", _id: "m3" },
      { kind: "tool_call", _id: "m4" },
    ]
    expect(findLastUserMessageId(messages)).toBe("m3")
  })

  test("returns null when no user prompts exist", () => {
    expect(findLastUserMessageId([{ kind: "assistant_text", _id: "m1" }])).toBeNull()
    expect(findLastUserMessageId([])).toBeNull()
  })
})
